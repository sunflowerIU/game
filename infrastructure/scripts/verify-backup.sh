#!/bin/sh
set -eu

test "$#" -eq 1 || { echo "Usage: $0 /absolute/path/postgres-TIMESTAMP.dump" >&2; exit 1; }
backup_file=$1
case "$backup_file" in /*) :;; *) echo "Backup path must be absolute" >&2; exit 1;; esac
test -f "$backup_file" || { echo "Backup does not exist: $backup_file" >&2; exit 1; }
test -f "$backup_file.sha256" || { echo "Missing checksum: $backup_file.sha256" >&2; exit 1; }
(cd "$(dirname "$backup_file")" && sha256sum -c "$(basename "$backup_file").sha256")

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
environment_file=${ENVIRONMENT_FILE:-"$project_dir/.env.production"}
compose() { docker compose --env-file "$environment_file" -f "$project_dir/compose.production.yaml" "$@"; }
verify_database="restore_check_$(date -u +%Y%m%d%H%M%S)_$$"
cleanup() { compose exec -T postgres sh -c 'dropdb --if-exists --username="$POSTGRES_USER" "$1"' sh "$verify_database" >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM

compose exec -T postgres sh -c 'createdb --username="$POSTGRES_USER" "$1"' sh "$verify_database"
compose exec -T postgres sh -c 'pg_restore --exit-on-error --no-owner --no-acl --username="$POSTGRES_USER" --dbname="$1"' sh "$verify_database" < "$backup_file"
compose exec -T postgres sh -c 'psql --username="$POSTGRES_USER" --dbname="$1" --tuples-only --command="SELECT count(*) FROM \"_prisma_migrations\""' sh "$verify_database"
echo "Backup restored and queried successfully in isolated database $verify_database"
