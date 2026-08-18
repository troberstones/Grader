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

echo "==> Installing, building, and restarting on remote"
ssh "$REMOTE" "
  set -e
  export PATH=\"$NODE_BIN:\$PATH\"
  cd $REMOTE_DIR
  npm install
  npm run build
  systemctl --user restart grader.service
  mkdir -p ~/.config/systemd/user
  cp scripts/systemd/grader-backup.service scripts/systemd/grader-backup.timer ~/.config/systemd/user/
  systemctl --user daemon-reload
  systemctl --user enable --now grader-backup.timer
"

echo "==> Status"
ssh "$REMOTE" "systemctl --user status grader.service --no-pager -l | head -n 10"
