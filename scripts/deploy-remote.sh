#!/usr/bin/env bash
# Build a new release of grader on cs-1017245 in a staging copy, next to the
# live app, and only swap it in if the build and a post-restart health check
# both succeed — the live app keeps serving every class in front of it the
# entire time the build runs, and a bad build or a bad restart never reaches
# it at all. See docs/operations.md "Deploy".
#
# Usage: ./scripts/deploy-remote.sh
#
# For a bad deploy that passed its health check but is still wrong (e.g. a
# regression the health check can't see), use scripts/rollback-remote.sh
# instead of re-running this.
set -euo pipefail

REMOTE_USER="cnh5"
REMOTE_HOST="cs-1017245.cs.byu.edu"
REMOTE="$REMOTE_USER@$REMOTE_HOST"

# The one source of truth for which Node install runs this app. If you change
# this, scripts/systemd/grader.service's ExecStart line must be updated to
# match — a systemd unit can't source a shell variable, so the two have to be
# kept in sync by hand.
NODE_BIN="/work/cnh5/.nvm/versions/node/v22.23.2/bin"

# The live app (storage/, certs/ and .env* here are never overwritten by this
# script), a staging copy the new release is built in while the live app
# keeps running, and a full copy of the previous release kept for rollback —
# by scripts/rollback-remote.sh, or automatically here if the health check
# below fails. All three are siblings under /work/cnh5, matched by the
# EXCLUDE_LIVE_ONLY list any time one is synced against another.
REMOTE_DIR="/work/cnh5/grader"
STAGING_DIR="/work/cnh5/grader-staging"
PREVIOUS_DIR="/work/cnh5/grader-previous"

# Port server.mjs listens on — see its file comment for why HTTP and HTTPS
# both have to share this one port. Override if the deploy host ever changes.
PORT="${PORT:-3000}"

cd "$(dirname "$0")/.."

echo "==> Syncing working tree to $REMOTE:$STAGING_DIR (staging — live app untouched so far)"
rsync -av --delete \
  --exclude-from=.gitignore \
  --exclude .git \
  --exclude .claude \
  --exclude 'packages/*/node_modules' \
  ./ "$REMOTE:$STAGING_DIR/"

echo "==> Building on remote in staging (live app keeps running)"
ssh "$REMOTE" bash -s -- "$NODE_BIN" "$STAGING_DIR" <<'REMOTE_BUILD'
set -euo pipefail
NODE_BIN="$1"
STAGING_DIR="$2"
export PATH="$NODE_BIN:$PATH"

cd "$STAGING_DIR"
npm ci
npm run build
REMOTE_BUILD

echo "==> Build succeeded — backing up, migrating, and swapping in the new release"
ssh "$REMOTE" bash -s -- "$NODE_BIN" "$REMOTE_DIR" "$STAGING_DIR" "$PREVIOUS_DIR" "$PORT" <<'REMOTE_SWAP'
set -euo pipefail
NODE_BIN="$1"
REMOTE_DIR="$2"
STAGING_DIR="$3"
PREVIOUS_DIR="$4"
PORT="$5"
export PATH="$NODE_BIN:$PATH"

# storage/, certs/, and .env* live only in $REMOTE_DIR and must never be
# duplicated, deleted, or overwritten by a sync between these directories —
# every rsync below that touches $REMOTE_DIR excludes all three.
EXCLUDE_LIVE_ONLY=(--exclude storage --exclude certs --exclude '.env*')

health_check() {
  # Prefer HTTPS (what every device actually uses, per server.mjs) but fall
  # back to HTTP so this still works on a host with no certificate yet — -k
  # accepts the self-signed cert, -f treats any non-2xx as failure.
  for scheme in https http; do
    if curl -fsk --max-time 5 "$scheme://localhost:$PORT/api/health" >/dev/null 2>&1; then
      return 0
    fi
  done
  return 1
}

wait_for_healthy() {
  for _ in $(seq 1 15); do
    if health_check; then return 0; fi
    sleep 2
  done
  return 1
}

# Snapshot the current live release (everything except the data that only
# ever lives in $REMOTE_DIR) for rollback, before it's touched or even
# created. Checked before the mkdir -p below, which would otherwise make an
# empty $REMOTE_DIR look non-empty. Skipped on a brand-new install where
# there's nothing running yet.
if [ -n "$(ls -A "$REMOTE_DIR" 2>/dev/null || true)" ]; then
  echo "--> Snapshotting current release to $PREVIOUS_DIR for rollback"
  rsync -a --delete "${EXCLUDE_LIVE_ONLY[@]}" "$REMOTE_DIR/" "$PREVIOUS_DIR/"
fi

mkdir -p "$REMOTE_DIR/storage" ~/.config/systemd/user

echo "--> Stopping grader.service"
systemctl --user stop grader.service 2>/dev/null || true

if [ -f "$REMOTE_DIR/storage/grader.db" ]; then
  echo "--> Backing up database"
  (cd "$REMOTE_DIR" && node scripts/backup-db.mjs)
fi

# Run the *staging* copy's migrate.mjs (it has whatever new drizzle/NNNN_*.sql
# files this release adds) against the *live* database file. This is not
# rolled back if the health check below fails — see docs/operations.md
# "Rollback" for why, and restore from the backup just taken if that happens
# and the migration is the problem.
echo "--> Migrating live database"
(cd "$STAGING_DIR" && DB_PATH="$REMOTE_DIR/storage/grader.db" node scripts/migrate.mjs)

echo "--> Swapping the new release into $REMOTE_DIR"
rsync -a --delete "${EXCLUDE_LIVE_ONLY[@]}" "$STAGING_DIR/" "$REMOTE_DIR/"

cp "$REMOTE_DIR/scripts/systemd/grader.service" ~/.config/systemd/user/
systemctl --user daemon-reload

echo "--> Starting grader.service"
systemctl --user enable grader.service >/dev/null
systemctl --user restart grader.service

echo "--> Waiting for /api/health"
if wait_for_healthy; then
  echo "--> Healthy."
else
  echo "!!! /api/health did not come up healthy after restart — rolling back to the previous release." >&2
  rsync -a --delete "${EXCLUDE_LIVE_ONLY[@]}" "$PREVIOUS_DIR/" "$REMOTE_DIR/"
  systemctl --user restart grader.service
  if wait_for_healthy; then
    echo "!!! Rolled back to the previous release, which is healthy again. The new release did NOT go live." >&2
    echo "!!! Note: any database migration that ran above was NOT undone — see docs/operations.md \"Rollback\"." >&2
  else
    echo "!!! Rollback restart is ALSO unhealthy — this needs a person on the console, not another automated retry." >&2
  fi
  exit 1
fi

# grader-backup.service/.timer are owned by a different part of this project
# (see docs/operations.md "Backup & restore"); reinstalling them here is
# unrelated to the swap above but has always been part of this deploy step.
cp "$REMOTE_DIR/scripts/systemd/grader-backup.service" "$REMOTE_DIR/scripts/systemd/grader-backup.timer" ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now grader-backup.timer
REMOTE_SWAP

echo "==> Status"
ssh "$REMOTE" "systemctl --user status grader.service --no-pager -l | head -n 10"
