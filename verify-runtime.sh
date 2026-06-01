#!/usr/bin/env bash
set -euo pipefail

YELLOW="\033[0;33m"
GREEN="\033[0;32m"
RED="\033[0;31m"
NC="\033[0m"

echo -e "${YELLOW}Verifying runtime infrastructure...${NC}"

if ! command -v docker >/dev/null 2>&1; then
  echo -e "${RED}docker not found. Install Docker.${NC}"
  exit 1
fi

echo -e "${GREEN}Checking containers for aegis-redis, aegis-mongodb, aegis-kafka...${NC}"
docker ps --filter "name=aegis-redis" --filter "name=aegis-mongodb" --filter "name=aegis-kafka" --format "{{.Names}}: {{.Status}}"

echo -e "${GREEN}Attempting Kafka topic list via container (if running)...${NC}"
if docker ps --filter "name=aegis-kafka" --format "{{.Names}}" | grep -q aegis-kafka; then
  docker exec aegis-kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list || true
else
  echo -e "${YELLOW}aegis-kafka container not running; skipping Kafka checks.${NC}"
fi

echo -e "${GREEN}Verify complete.${NC}"
