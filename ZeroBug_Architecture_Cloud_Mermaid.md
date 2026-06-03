flowchart LR
    subgraph EXT["External"]

        USER["👤 Browser
        ─────────────
        Chat.jsx
        streamMessage.js
        CredentialForm.jsx
        ApprovalCard.jsx
        Vite · React 18 · port 2606"]

        EMAIL["📧 Email Subscriber
        ─────────────    
        Approver inbox
        ZeroBug approval alerts"]
    end
    subgraph API["API Layer"]
        APIGW["🔀 API Gateway
        ─────────────
        LambdaRestApi · Mangum
        proxy=True · CORS ALL_ORIGINS"]

        APILAMBDA["⚡ API Lambda
        ─────────────
        FastAPI · Python 3.12
        POST /api/sessions
        POST /sessions/id/message/stream SSE
        POST /sessions/id/credentials
        POST /sessions/id/approve
        POST /webhooks/approve HMAC
        GET  /sessions/id/activity
        POST /sessions/id/files 20MB"]
    end

    subgraph DATA["Shared Data & Security"]
        DYNAMO["🗄 Amazon DynamoDB
        ─────────────
        zerobug-sessions · PAY_PER_REQUEST
        PK: session_id · CUSTOMER_MANAGED
        conversation[] · credentials{}
        approval_items[] · activity[]
        status · context · files[]"]

        KMS["🔑 AWS KMS
        ─────────────
        alias/zerobug · CMK
        enable_key_rotation=True
        Grants: ApiLambda + RuntimeLambda
        encrypt → credentials.py on POST
        decrypt → handler.py before sandbox
        DynamoDB also encrypted double-layer"]
    end

    subgraph COMPUTE["Compute Layer"]
        RUNTIME["⚡ Runtime Lambda
        ─────────────
        Claude agentic loop · handler.py
        _load_session → DynamoDB
        _get_credentials → KMS decrypt
        _stream_one_bedrock_call
        ─────────────
        _find execute → invoke_sandbox
        _find ask → user question
        _find approval_needed → SNS
        _find done → complete
        ─────────────
        loop: result → conversation[]"]

        SANDBOX["🔒 Sandbox Lambda
        ─────────────
        executor.py · isolated exec
        _validate blocks subprocess/socket/IMDS
        os.environ[key]=value just-in-time
        exec in daemon thread 30s
        finally: restore env vars
        returns: output · RESULT · error"]
    end

    subgraph AI["AI & Messaging"]
        BEDROCK["🤖 Amazon Bedrock
        ─────────────
        claude-3-5-sonnet-20241022
        converse_stream · Extended thinking
        budget_tokens: 2000
        zero-retention · stays in AWS"]

        SNS["📣 Amazon SNS
        ─────────────
        zerobug-approvals
        Published on approval_needed
        Email subscription via CDK"]
    end

    USER        -- "① HTTPS"              --> APIGW
    APIGW       -- "② proxy"              --> APILAMBDA
    APILAMBDA   -. "③ SSE stream back"   .-> USER
    APILAMBDA   -- "④ invoke"             --> RUNTIME
    APILAMBDA   -- "⑤ session CRUD"       --> DYNAMO
    APILAMBDA   -- "⑥ kms.encrypt"        --> KMS
    DYNAMO      -- "⑦ read session"        --> RUNTIME
    RUNTIME     -- "write session"         --> DYNAMO
    KMS         -- "⑧ kms.decrypt"         --> RUNTIME
    RUNTIME     -- "⑨ converse_stream"    --> BEDROCK
    RUNTIME     -- "⑩ invoke_sandbox"     --> SANDBOX
    RUNTIME     -- "⑪ sns.publish"        --> SNS
    SNS         -- "⑫ email"              --> EMAIL

    classDef lambda   fill:#F3E5F5,stroke:#7B1FA2,color:#4A148C
    classDef storage  fill:#E3F2FD,stroke:#1565C0,color:#0D47A1
    classDef security fill:#FFEBEE,stroke:#C62828,color:#B71C1C
    classDef ai       fill:#E0F2F1,stroke:#00695C,color:#004D40
    classDef messaging fill:#FCE4EC,stroke:#AD1457,color:#880E4F
    classDef external fill:#F8F8FF,stroke:#7B1FA2,color:#4A148C
    classDef isolated fill:#E8F5E9,stroke:#2E7D32,color:#1B5E20

    class APIGW,APILAMBDA,RUNTIME lambda
    class DYNAMO storage
    class KMS security
    class BEDROCK ai
    class SNS messaging
    class USER,EMAIL external
    class SANDBOX isolated