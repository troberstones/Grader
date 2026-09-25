#!/usr/bin/env bash
# Sync the working tree to cs-1017245 and restart the running instance.
# Usage: ./scripts/deploy-remote.sh
set -euo pipefail

REMOTE_USER="cnh5"
REMOTE_HOST="cs-1017245.cs.byu.edu"
REMOTE_DIR="/work/cnh5/grader"
NODE_BIN="/work/cnh5/.nvm/versions/node/v22.23.2/bin"
REMOTE="$REMOTE_USER@$REMOTE_HOST"

cd "$(dirname "$0")/.."

echo "==> Syncing working tree to $REMOTE:$REMOTE_DIR"
rsync -av --delete \
  --exclude-from=.gitignore \
  --exclude .git \
  --exclude .claude \
  --exclude 'packages/*/node_modules' \
  ./ "$REMOTE:$REMOTE_DIR/"

echo "==> Installing, migrating, building, and restarting on remote"
ssh "$REMOTE" "
  set -e
  export PATH=\"$NODE_BIN:\$PATH\"
  cd $REMOTE_DIR
  npm install

  # Migrate before building and restarting, so the new code never serves a
  # request against the old schema. Deploying and migrating used to be two
  # commands, which meant every schema change had a window where the running
  # app queried columns that did not exist yet — and forgetting the second
  # command left it that way indefinitely.
  #
  # The reverse exposure, old code against the new schema, lasts until the
  # restart a few lines below and is harmless: these migrations only add
  # columns and tables, which code that does not know about them ignores.
  #
  # scripts/migrate.mjs applies every drizzle/NNNN_*.sql file that hasn't run
  # yet, in numeric (dependency) order, and records each one — so re-running
  # it on every deploy is a fast no-op once the database is caught up,
  # instead of re-deriving \"already applied\" from table/column presence on
  # every single deploy the way the old scripts/apply-*.mjs loop did. See
  # docs/operations.md for how it decides what's pending on a database it
  # hasn't tracked before (i.e. this one, the first time it runs there).
  node scripts/backup-db.mjs
  node scripts/migrate.mjs

  npm run build
  systemctl --user restart grader.service
  mkdir -p ~/.config/systemd/user
  cp scripts/systemd/grader-backup.service scripts/systemd/grader-backup.timer ~/.config/systemd/user/
  systemctl --user daemon-reload
  systemctl --user enable --now grader-backup.timer
"

echo "==> Status"
ssh "$REMOTE" "systemctl --user status grader.service --no-pager -l | head -n 10"
