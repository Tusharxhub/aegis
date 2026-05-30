.PHONY: trigger-oom trigger-timeout trigger-port

trigger-oom:
	@echo "Triggering OOM crash..."
	curl -X GET http://localhost:3002/crash/oom

trigger-timeout:
	@echo "Triggering timeout crash..."
	curl -X GET http://localhost:3002/crash/timeout

trigger-port:
	@echo "Triggering port conflict crash..."
	curl -X GET http://localhost:3002/crash/port
