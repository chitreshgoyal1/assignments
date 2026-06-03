import os
import aws_cdk as cdk
from aws_cdk import (
    Stack,
    Duration,
    RemovalPolicy,
    CfnOutput,
    aws_dynamodb as dynamodb,
    aws_lambda as _lambda,
    aws_apigateway as apigw,
    aws_iam as iam,
    aws_sns as sns,
    aws_sns_subscriptions as sns_subs,
    aws_kms as kms,
    aws_ec2 as ec2,
    aws_s3 as s3,
)
from constructs import Construct


# Domains SandboxLambda is permitted to reach; enforced at app layer.
# For host-level enforcement in prod, replace the NAT gateway with
# AWS Network Firewall + domain allowlist rules.
ALLOWED_DOMAINS = [
    "github.com",
    "api.github.com",
    "atlassian.net",
    "api.osv.dev",
]


class ZeroBugStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs):
        super().__init__(scope, construct_id, **kwargs)

        # ── KMS key ──────────────────────────────────────────────────────
        credential_key = kms.Key(
            self,
            "CredentialKey",
            alias="alias/zerobug",
            description="Encrypts user credentials stored in DynamoDB sessions",
            enable_key_rotation=True,
            removal_policy=RemovalPolicy.RETAIN,
        )

        # ── DynamoDB: ZeroBugSessions ─────────────────────────────────────
        sessions_table = dynamodb.Table(
            self,
            "SessionsTable",
            table_name="zerobug-sessions",
            partition_key=dynamodb.Attribute(
                name="session_id", type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            time_to_live_attribute="expires_at",
            encryption=dynamodb.TableEncryption.CUSTOMER_MANAGED,
            encryption_key=credential_key,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # ── SNS: ZeroBugApprovals ─────────────────────────────────────────
        approvals_topic = sns.Topic(
            self,
            "ApprovalsTopic",
            topic_name="zerobug-approvals",
            display_name="ZeroBug — human approval requests",
        )

        # Email subscription — requires APPROVAL_EMAIL context var:
        #   cdk deploy --context approval_email=you@example.com
        # AWS sends a confirmation email; subscription is pending until confirmed.
        approval_email = self.node.try_get_context("approval_email")
        if approval_email:
            approvals_topic.add_subscription(
                sns_subs.EmailSubscription(
                    approval_email,
                    json=False,   # plain-text email, not JSON wrapper
                )
            )

        # ── S3: artifact exchange between Runtime and Sandbox ─────────────
        artifacts_bucket = s3.Bucket(
            self,
            "ArtifactsBucket",
            bucket_name=f"zerobug-artifacts-{self.account}",
            encryption=s3.BucketEncryption.S3_MANAGED,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
        )

        # ── VPC for SandboxLambda ─────────────────────────────────────────
        # Private subnets + one NAT gateway gives outbound internet access
        # only through a controlled path.  An S3 gateway endpoint keeps
        # S3 traffic off the NAT gateway (free + faster).
        vpc = ec2.Vpc(
            self,
            "SandboxVpc",
            max_azs=2,
            nat_gateways=1,
            subnet_configuration=[
                ec2.SubnetConfiguration(
                    name="public",
                    subnet_type=ec2.SubnetType.PUBLIC,
                    cidr_mask=24,
                ),
                ec2.SubnetConfiguration(
                    name="private",
                    subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    cidr_mask=24,
                ),
            ],
        )

        vpc.add_gateway_endpoint(
            "S3GatewayEndpoint",
            service=ec2.GatewayVpcEndpointAwsService.S3,
        )

        # Allow only outbound HTTPS; all other egress is dropped.
        sandbox_sg = ec2.SecurityGroup(
            self,
            "SandboxSG",
            vpc=vpc,
            description="SandboxLambda — HTTPS egress only",
            allow_all_outbound=False,
        )
        sandbox_sg.add_egress_rule(
            ec2.Peer.any_ipv4(),
            ec2.Port.tcp(443),
            "HTTPS to allowed external APIs via NAT",
        )

        # ── Lambda Layer: sandbox libraries ──────────────────────────────
        # layer/python/ must be pre-populated before cdk deploy by running:
        #   pip install -r layer/requirements.txt -t layer/python --no-cache-dir
        sandbox_layer = _lambda.LayerVersion(
            self,
            "SandboxLibsLayer",
            layer_version_name="zerobug-sandbox-libs",
            description="Pre-installed libraries for Claude-generated sandbox code",
            compatible_runtimes=[_lambda.Runtime.PYTHON_3_12],
            code=_lambda.Code.from_asset("../layer"),
        )

        # ── Lambda: SandboxLambda ─────────────────────────────────────────
        sandbox_fn = _lambda.Function(
            self,
            "SandboxLambda",
            function_name="zerobug-sandbox",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="executor.handler",
            code=_lambda.Code.from_asset("../sandbox"),
            timeout=Duration.minutes(5),
            memory_size=512,
            vpc=vpc,
            vpc_subnets=ec2.SubnetSelection(
                subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS
            ),
            security_groups=[sandbox_sg],
            layers=[sandbox_layer],
            environment={
                "ALLOWED_DOMAINS": ",".join(ALLOWED_DOMAINS),
                "ARTIFACTS_BUCKET": artifacts_bucket.bucket_name,
            },
        )
        # S3 read only — no DynamoDB or other AWS service access
        artifacts_bucket.grant_read(sandbox_fn)

        # ── Lambda: RuntimeLambda ─────────────────────────────────────────
        runtime_fn = _lambda.Function(
            self,
            "RuntimeLambda",
            function_name="zerobug-runtime",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="handler.handler",
            code=_lambda.Code.from_asset("../runtime"),
            timeout=Duration.minutes(15),
            memory_size=1024,
            environment={
                "SESSIONS_TABLE": sessions_table.table_name,
                "SANDBOX_LAMBDA_NAME": sandbox_fn.function_name,
                "BEDROCK_REGION": self.region,
                "APPROVALS_TOPIC_ARN": approvals_topic.topic_arn,
                "ARTIFACTS_BUCKET": artifacts_bucket.bucket_name,
            },
        )
        sessions_table.grant_read_write_data(runtime_fn)
        sandbox_fn.grant_invoke(runtime_fn)
        approvals_topic.grant_publish(runtime_fn)
        artifacts_bucket.grant_read_write(runtime_fn)
        credential_key.grant_encrypt_decrypt(runtime_fn)

        runtime_fn.add_to_role_policy(
            iam.PolicyStatement(
                sid="BedrockInvokeModel",
                actions=[
                    "bedrock:InvokeModel",
                    "bedrock:InvokeModelWithResponseStream",
                ],
                resources=[
                    f"arn:aws:bedrock:{self.region}::foundation-model/*"
                ],
            )
        )

        # ── Lambda: ApiLambda (FastAPI via Mangum) ────────────────────────
        api_fn = _lambda.Function(
            self,
            "ApiLambda",
            function_name="zerobug-api",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="main.handler",   # requires: handler = Mangum(app) in main.py
            code=_lambda.Code.from_asset("../api"),
            timeout=Duration.seconds(30),
            memory_size=256,
            environment={
                "SESSIONS_TABLE": sessions_table.table_name,
                "APPROVALS_TOPIC_ARN": approvals_topic.topic_arn,
                "RUNTIME_LAMBDA_ARN": runtime_fn.function_arn,
                "SANDBOX_LAMBDA_ARN": sandbox_fn.function_arn,
            },
        )
        sessions_table.grant_read_write_data(api_fn)
        approvals_topic.grant_publish(api_fn)
        runtime_fn.grant_invoke(api_fn)
        credential_key.grant_encrypt_decrypt(api_fn)

        # ── API Gateway ───────────────────────────────────────────────────
        api = apigw.LambdaRestApi(
            self,
            "ZeroBugApi",
            rest_api_name="zerobug-api",
            handler=api_fn,
            proxy=True,
            default_cors_preflight_options=apigw.CorsOptions(
                allow_origins=apigw.Cors.ALL_ORIGINS,
                allow_methods=apigw.Cors.ALL_METHODS,
                allow_headers=["Content-Type", "Authorization"],
            ),
        )

        # ── Outputs ───────────────────────────────────────────────────────
        CfnOutput(self, "ApiUrl", value=api.url, description="API Gateway base URL")
        CfnOutput(
            self,
            "RuntimeLambdaArn",
            value=runtime_fn.function_arn,
            description="Runtime Lambda ARN",
        )
