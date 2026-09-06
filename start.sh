#!/bin/sh
set -eu
if [ -n "${LITESTREAM_BUCKET:-}" ]; then
  if [ ! -f "$DATABASE_PATH" ]; then
    litestream restore -if-replica-exists -config /app/litestream.yml "$DATABASE_PATH"
  fi
  exec litestream replicate -config /app/litestream.yml -exec "npm start"
fi
echo "WARNING: LITESTREAM_BUCKET is not set; running without replication, data is lost on restart" >&2
exec npm start
