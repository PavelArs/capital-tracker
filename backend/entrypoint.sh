#!/bin/sh
set -e

echo "Running migrations..."

# Run all SQL migrations
for f in migrations/*.sql; do
  if [ -f "$f" ]; then
    echo "Running migration: $f"
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USERNAME -d $DB_NAME -f "$f" || echo "Warning: $f failed (might be already applied)"
  fi
done

echo "Starting application..."
node dist/main.js

