#!/bin/sh
# Hosts often mount the data volume owned by root. Make it the app user's,
# then run as that user (not root). Already running as a normal user: just run.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "${DATA_DIR:-/data}"
  chown -R node:node "${DATA_DIR:-/data}" 2>/dev/null || true
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
