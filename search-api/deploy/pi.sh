#!/usr/bin/env bash
set -euo pipefail

PI_HOST="${PI_HOST:-freak@192.168.31.50}"
PI_KEY="${PI_KEY:-/Users/freakk/.ssh/pi}"
REMOTE_DIR="${REMOTE_DIR:-/home/freak/Projects/Vantage-Search-API}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEARXNG_DIGEST="sha256:5286edb35782454ab8a102c5eff6b54bff745853191b46aeead95f225aa6dfb6"
SEARXNG_IMAGE="vantage-searxng:sha5286edb35782"
API_IMAGE="vantage-search-api:pi"
REDIS_IMAGE="redis:7-alpine"

echo "[1/4] Build Linux ARM64 images locally"
if ! docker image inspect "${SEARXNG_IMAGE}" >/dev/null 2>&1; then
  docker pull --platform linux/arm64 "docker.io/searxng/searxng@${SEARXNG_DIGEST}"
  docker tag "docker.io/searxng/searxng@${SEARXNG_DIGEST}" "${SEARXNG_IMAGE}"
fi
if ! docker image inspect "${REDIS_IMAGE}" >/dev/null 2>&1; then
  docker pull --platform linux/arm64 "${REDIS_IMAGE}"
fi
docker build --pull=false --platform linux/arm64 -t "${API_IMAGE}" "${ROOT_DIR}"

echo "[2/4] Load images onto ${PI_HOST}"
docker save "${API_IMAGE}" "${SEARXNG_IMAGE}" "${REDIS_IMAGE}" |
  ssh -i "${PI_KEY}" "${PI_HOST}" docker load

echo "[3/4] Sync source and prepare persistent secrets"
ssh -i "${PI_KEY}" "${PI_HOST}" mkdir -p "${REMOTE_DIR}"
rsync -az \
  --exclude '.git' \
  --exclude '.env' \
  --exclude '.venv' \
  --exclude '__pycache__' \
  --exclude '.pytest_cache' \
  --exclude 'benchmarks/private/' \
  -e "ssh -i ${PI_KEY}" \
  "${ROOT_DIR}/" "${PI_HOST}:${REMOTE_DIR}/"

echo "[4/4] Start containers and check readiness"
ssh -i "${PI_KEY}" "${PI_HOST}" bash -se -- "${REMOTE_DIR}" <<'REMOTE'
cd "$1"
python3 deploy/prepare_env.py
docker compose -f docker-compose.yml -f docker-compose.pi.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.pi.yml up -d --no-build --pull never
for attempt in {1..20}; do
  if curl -fsS --max-time 3 http://127.0.0.1:8787/ready; then
    exit 0
  fi
  sleep 3
done
docker compose -f docker-compose.yml -f docker-compose.pi.yml ps
exit 1
REMOTE

echo "Vantage Search API is ready on 127.0.0.1:8787 on the Pi."
