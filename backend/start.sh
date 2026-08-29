#!/bin/sh
set -e
cd "$(dirname "$0")"
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-3000}"
export HOST="${HOST:-0.0.0.0}"
if [ -z "$JWT_SECRET" ]; then
  echo "Set JWT_SECRET in backend/.env before starting in production."
  exit 1
fi
exec node server.js
