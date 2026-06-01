#!/usr/bin/env bash
#
# Setup script for Turso database (Netlify deployment)
#
# Prerequisites:
#   - Install Turso CLI: curl -sSfL https://get.tur.so/install.sh | bash
#   - Login: turso auth login
#
# Usage:
#   ./scripts/setup_turso_db.sh [database-name]
#
# This script:
#   1. Creates a Turso database (or uses an existing one)
#   2. Applies all SQL migrations in order
#   3. Prints the DATABASE_URL and AUTH_TOKEN for Netlify env vars
#

set -euo pipefail

DB_NAME="${1:-ews-notifications}"
MIGRATIONS_DIR="$(dirname "$0")/../migrations"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  EWS Netlify - Turso Database Setup                         ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Check turso CLI is installed
if ! command -v turso &>/dev/null; then
  echo "❌ Turso CLI not found. Install it:"
  echo "   curl -sSfL https://get.tur.so/install.sh | bash"
  exit 1
fi

# Check authentication
if ! turso auth status &>/dev/null 2>&1; then
  echo "❌ Not logged in to Turso. Run: turso auth login"
  exit 1
fi

echo "📦 Creating database: ${DB_NAME}..."
if turso db show "$DB_NAME" &>/dev/null 2>&1; then
  echo "   ↳ Database already exists, using existing."
else
  turso db create "$DB_NAME"
  echo "   ↳ Created."
fi

echo ""
echo "📋 Applying migrations..."

# Sort migrations by filename and apply in order
for migration in $(find "$MIGRATIONS_DIR" -name "*.sql" | sort); do
  filename=$(basename "$migration")
  echo "   ↳ Applying: $filename"
  turso db shell "$DB_NAME" < "$migration"
done

echo ""
echo "✅ All migrations applied."
echo ""

# Get connection details
DB_URL=$(turso db show "$DB_NAME" --url)
echo "📊 Database URL:"
echo "   TURSO_DATABASE_URL=${DB_URL}"
echo ""

echo "🔑 Creating auth token..."
AUTH_TOKEN=$(turso db tokens create "$DB_NAME")
echo "   TURSO_AUTH_TOKEN=${AUTH_TOKEN}"
echo ""

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Add these to your Netlify environment variables:           ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  TURSO_DATABASE_URL=${DB_URL}"
echo "║  TURSO_AUTH_TOKEN=${AUTH_TOKEN}"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Set them in Netlify UI → Site Settings → Environment Variables"
echo "Or via CLI: netlify env:set TURSO_DATABASE_URL \"${DB_URL}\""
echo "            netlify env:set TURSO_AUTH_TOKEN \"${AUTH_TOKEN}\""
