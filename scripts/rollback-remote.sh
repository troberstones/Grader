#!/usr/bin/env bash
# One-command manual rollback: restore the previous release that
# scripts/deploy-remote.sh snapshotted to grader-previous/ before its last
# swap, and restart. Use this when a deploy passed its health check but is
# still wrong in some way the health check can't see (deploy-remote.sh
# already rolls back automatically when the health check itself fails).
#
# Usage: ./scripts/rollback-remote.sh
#
# Does NOT touch storage/, certs/, or .env* — those only ever live in the
# live directory. Does NOT undo any database migration the bad deploy ran —
# see docs/operations.md "Rollback" for what to do if the migration itself is
# the problem (restore from the pre-deploy backup under storage/backups/).
set -euo pipefail

REMOTE_USER="cnh5"
REMOTE_HOST="cs-1017245.cs.byu.edu"
REMOTE="$REMOTE_USER@$REMOTE_HOST"

REMOTE_DIR="/work/cnh5/grader"
PREVIOUS_DIR="/work/cnh5/grader-previous"
PORT="${PORT:-3000}"

echo "==> Rolling back $REMOTE:$REMOTE_DIR to $PREVIOUS_DIR"
ssh "$REMOTE" bash -s -- "$REMOTE_DIR" "$PREVIOUS_DIR" "$PORT" <<'REMOTE_ROLLBACK'
set -euo pipefail
REMOTE_DIR="$1"
PREVIOUS_DIR="$2"
PORT="$3"

if [ -z "$(ls -A "$PREVIOUS_DIR" 2>/dev/null || true)" ]; then
  echo "!!! $PREVIOUS_DIR is empty or missing — nothing to roll back to (has a deploy ever run?)." >&2
  exit 1
fi

health_check() {
  for scheme in https http; do
    if curl -fsk --max-time 5 "$scheme://localhost:$PORT/api/health" >/dev/null 2>&1; then
      return 0
    fi
  done
  # The previous release may predate /api/health: any non-5xx answer from
  # /login counts as up in that case.
  local code
  for scheme in https http; do
    code="$(curl -sk --max-time 5 -o /dev/null -w '%{http_code}' "$scheme://localhost:$PORT/login" 2>/dev/null || true)"
    case "$code" in 2*|3*) return 0 ;; esac
  done
  return 1
}

echo "--> Restoring previous release"
# Anchored: see EXCLUDE_LIVE_ONLY in deploy-remote.sh.
rsync -a --delete --exclude /storage --exclude /certs --exclude '/.env*' "$PREVIOUS_DIR/" "$REMOTE_DIR/"

echo "--> Restarting grader.service"
systemctl --user restart grader.service

echo "--> Waiting for /api/health"
for _ in $(seq 1 15); do
  if health_check; then
    echo "--> Healthy on the restored previous release."
    exit 0
  fi
  sleep 2
done

echo "!!! Restored the previous release, but it is not healthy either — this needs a person on the console." >&2
exit 1
REMOTE_ROLLBACK

echo "==> Status"
ssh "$REMOTE" "systemctl --user status grader.service --no-pager -l | head -n 10"
