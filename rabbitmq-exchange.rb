require 'rubygems'
#require 'pry'
require "bunny"
require ::File.expand_path('../../../config/environment',  __FILE__)
#conn = Bunny.new
STDOUT.sync = true
queue_name = Rails.configuration.notification_config['subscriber_routing_key'].to_s
exchange_name = queue_name

conn = Bunny.new(
  	hostname: "localhost",
    port: "5672",
    log_level: 0,
    log_file: Rails.root.to_s+"/tmp/notification.log",
    automatically_recover: true,
    user: "guest",
    pass: "guest"
)
conn.start

ch = conn.create_channel
	
	ch.direct(exchange_name, durable: false)
q  = ch.queue(queue_name, :durable => true)	#q  = ch.queue(queue_name, :auto_delete => true)
x  = ch.default_exchange


q.subscribe do |delivery_info, metadata, payload|
  puts "Received #{payload}"
end

#binding.pry
x.publish("Hello! Test from segmentation", :routing_key => q.name)

sleep 1.0
conn.close
