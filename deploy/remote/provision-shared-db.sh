#!/usr/bin/env bash
# One-time: provision inflxr's database + login role INSIDE the shared
# tradex-postgres instance. Run ON the droplet, once, before the first deploy
# (bootstrap.sh calls this for you, parsing the password from .env.production).
#
# This creates a SEPARATE `inflxr` database owned by a SEPARATE `inflxr` role. It
# does NOT touch tradex's or hiredesq's databases/roles — they share a Postgres
# *instance*, not data. A single owning role is correct for v1 (RLS deferred —
# CLAUDE.md §1; app-layer workspace/brand scoping is the tenancy backstop).
#
# Usage (on the droplet):
#   INFLXR_DB_PASSWORD='<strong-secret>' ./provision-shared-db.sh
#
# The password MUST match the one in /opt/inflxr/.env.production (DATABASE_URL).
# We connect as tradex-postgres's superuser, reading POSTGRES_USER from the
# running container rather than hardcoding it.

set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-tradex-postgres}"
INFLXR_DB="${INFLXR_DB:-inflxr}"
INFLXR_ROLE="${INFLXR_ROLE:-inflxr}"

: "${INFLXR_DB_PASSWORD:?set INFLXR_DB_PASSWORD to the password used in /opt/inflxr/.env.production}"

SUPERUSER="$(docker exec "$PG_CONTAINER" printenv POSTGRES_USER)"
: "${SUPERUSER:?could not read POSTGRES_USER from $PG_CONTAINER}"

# SQL-escape the password for use as a literal.
PW_ESC="$(printf "%s" "$INFLXR_DB_PASSWORD" | sed "s/'/''/g")"

echo "==> provisioning role '$INFLXR_ROLE' + database '$INFLXR_DB' in $PG_CONTAINER (superuser=$SUPERUSER)"

# Role (idempotent). CREATE DATABASE can't run inside a DO block / transaction,
# so it's issued separately and guarded with \gexec.
docker exec -i "$PG_CONTAINER" \
  psql -v ON_ERROR_STOP=1 --username "$SUPERUSER" --dbname postgres <<EOSQL
DO \$do\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$INFLXR_ROLE') THEN
    CREATE ROLE "$INFLXR_ROLE" LOGIN PASSWORD '$PW_ESC';
  ELSE
    ALTER ROLE "$INFLXR_ROLE" WITH LOGIN PASSWORD '$PW_ESC';
  END IF;
END
\$do\$;

SELECT 'CREATE DATABASE "$INFLXR_DB" OWNER "$INFLXR_ROLE"'
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$INFLXR_DB')\gexec

GRANT ALL PRIVILEGES ON DATABASE "$INFLXR_DB" TO "$INFLXR_ROLE";
EOSQL

# Best-effort: pre-create the pgvector + pg_trgm extensions as the superuser.
# The current migrations (src/db/migrations.ts) do NOT create extensions, so this
# is NOT required today — but `vector` is a NON-trusted extension (the inflxr role
# can't `CREATE EXTENSION vector`), and the roadmap wants embeddings. Pre-creating
# now (idempotent) means a future migration's `CREATE EXTENSION IF NOT EXISTS` is a
# no-op. If the image lacks pgvector this warns rather than aborting provisioning.
echo "==> pre-creating extensions (pg_trgm, vector) in '$INFLXR_DB' (best-effort)"
docker exec -i "$PG_CONTAINER" \
  psql -v ON_ERROR_STOP=1 --username "$SUPERUSER" --dbname "$INFLXR_DB" <<'EOSQL' || echo "   ! extension pre-create failed (vector may be unavailable) — fine, migrations don't use it yet"
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
EOSQL

echo "==> done. inflxr can now connect as:"
echo "    postgresql://$INFLXR_ROLE:****@$PG_CONTAINER:5432/$INFLXR_DB"
echo "    (host = the container name '$PG_CONTAINER', reachable over the edge net)"
