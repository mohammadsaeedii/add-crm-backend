#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma migrate deploy

if [ "${RUN_SEED:-true}" = "true" ]; then
  echo "Seeding admin user..."
  node prisma/seed.js
fi

echo "Starting API..."
exec node dist/main.js
