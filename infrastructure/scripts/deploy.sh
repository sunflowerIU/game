#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
environment_file=${ENVIRONMENT_FILE:-"$project_dir/.env.production"}
compose_file="$project_dir/compose.production.yaml"
test -f "$environment_file" || { echo "Missing $environment_file" >&2; exit 1; }
test -f "$project_dir/infrastructure/secrets/cloudflare-origin.pem" || { echo "Missing Cloudflare origin certificate" >&2; exit 1; }
test -f "$project_dir/infrastructure/secrets/cloudflare-origin-key.pem" || { echo "Missing Cloudflare origin certificate key" >&2; exit 1; }

cd "$project_dir"
docker compose --env-file "$environment_file" -f "$compose_file" config --quiet
docker compose --env-file "$environment_file" -f "$compose_file" build --pull
docker compose --env-file "$environment_file" -f "$compose_file" up -d --remove-orphans
docker compose --env-file "$environment_file" -f "$compose_file" ps
