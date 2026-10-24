#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f package-lock.json ]]; then
  echo "post-merge setup requires package-lock.json" >&2
  exit 1
fi

npm ci --no-audit --no-fund
npm run db:push
