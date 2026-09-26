#!/usr/bin/env bash
set -Eeuo pipefail

if [[ -z "${OUTPUT_FILE:-}" ]]; then
  echo "Set OUTPUT_FILE to a protected path for the metrics capture." >&2
  exit 2
fi
if [[ ! "${DURATION_SECONDS:-0}" =~ ^[1-9][0-9]*$ ]]; then
  echo "DURATION_SECONDS must be a positive integer." >&2
  exit 2
fi
if [[ ! "${INTERVAL_SECONDS:-5}" =~ ^[1-9][0-9]*$ ]]; then
  echo "INTERVAL_SECONDS must be a positive integer." >&2
  exit 2
fi

command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 2; }
compose=(docker compose --env-file "${ENV_FILE:-.env.production}" -f "${COMPOSE_FILE:-compose.production.yaml}")
"${compose[@]}" ps --status running >/dev/null
container_ids="$("${compose[@]}" ps -q)"
[[ -n "$container_ids" ]] || { echo "No production Compose containers are running." >&2; exit 2; }

umask 077
mkdir -p "$(dirname -- "$OUTPUT_FILE")"
started="$(date -u +%s)"
deadline=$((started + DURATION_SECONDS))
while (( $(date -u +%s) < deadline )); do
  sampled_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  {
    printf '=== sample %s ===\n' "$sampled_at"
    printf '%s\n' '-- containers --'
    # Intentional word splitting: docker stats requires separate container IDs.
    # shellcheck disable=SC2086
    docker stats --no-stream --format '{{json .}}' $container_ids
    printf '%s\n' '-- application --'
    "${compose[@]}" exec -T server wget -qO- http://127.0.0.1:4000/internal/metrics || printf 'application_metrics_failed\n'
    printf '%s\n' '-- postgres --'
    "${compose[@]}" exec -T postgres sh -c 'psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT current_timestamp, numbackends, xact_commit, xact_rollback, blks_read, blks_hit, pg_database_size(current_database()) FROM pg_stat_database WHERE datname=current_database();"' || printf 'postgres_metrics_failed\n'
  } >> "$OUTPUT_FILE"
  sleep "${INTERVAL_SECONDS:-5}"
done

echo "Metrics captured in $OUTPUT_FILE"
