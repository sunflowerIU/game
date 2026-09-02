#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
environment_file=${ENVIRONMENT_FILE:-"$project_dir/.env.production"}
backup_dir=${BACKUP_DIR:-"/var/backups/game-platform"}
retention_days=${BACKUP_RETENTION_DAYS:-14}
compose() { docker compose --env-file "$environment_file" -f "$project_dir/compose.production.yaml" "$@"; }

case "$backup_dir" in /|"") echo "BACKUP_DIR must be a dedicated absolute directory" >&2; exit 1;; /*) :;; *) echo "BACKUP_DIR must be absolute" >&2; exit 1;; esac
case "$retention_days" in *[!0-9]*|"") echo "BACKUP_RETENTION_DAYS must be an integer" >&2; exit 1;; esac
test -f "$environment_file" || { echo "Missing $environment_file" >&2; exit 1; }
install -d -m 700 "$backup_dir"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
temporary_file=$(mktemp "$backup_dir/.postgres-$timestamp.XXXXXX")
final_file="$backup_dir/postgres-$timestamp.dump"
trap 'rm -f "$temporary_file"' EXIT HUP INT TERM
compose exec -T postgres sh -c 'exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --compress=6' > "$temporary_file"
test -s "$temporary_file" || { echo "pg_dump produced an empty backup" >&2; exit 1; }
compose exec -T postgres pg_restore --list < "$temporary_file" > /dev/null
chmod 600 "$temporary_file"
mv "$temporary_file" "$final_file"
sha256sum "$final_file" > "$final_file.sha256"
find "$backup_dir" -maxdepth 1 -type f \( -name 'postgres-*.dump' -o -name 'postgres-*.dump.sha256' \) -mtime "+$retention_days" -delete
trap - EXIT HUP INT TERM
echo "$final_file"
