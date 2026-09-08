#!/usr/bin/env bash
# Generate the self-signed certificate server.mjs serves HTTPS with.
#
# Run this once on the deploy host. `certs/` is gitignored, which also means
# rsync --exclude-from=.gitignore in deploy-remote.sh neither ships it nor
# deletes it, so what this writes survives every later deploy.
#
#   ./scripts/make-cert.sh                       # cert for $(hostname -f)
#   ./scripts/make-cert.sh cs-1017245.cs.byu.edu # or name the host explicitly
#   ./scripts/make-cert.sh --force               # replace an existing cert
#
# A self-signed certificate still produces a real secure context once accepted,
# which is all WebCodecs asks for. Browsers will warn the first time; on the
# studio iPads, install the .crt as a profile (Settings › General › VPN &
# Device Management) and enable it under About › Certificate Trust Settings.
# If the department ever issues a proper certificate, drop it in as
# certs/server.crt + certs/server.key and this script is never needed again.
set -euo pipefail

cd "$(dirname "$0")/.."

FORCE=0
HOST=""
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) HOST="$arg" ;;
  esac
done
[ -n "$HOST" ] || HOST="$(hostname -f 2>/dev/null || hostname)"

KEY=certs/server.key
CRT=certs/server.crt

if [ -e "$CRT" ] && [ "$FORCE" -ne 1 ]; then
  echo "$CRT already exists. Re-run with --force to replace it." >&2
  openssl x509 -in "$CRT" -noout -subject -enddate -ext subjectAltName
  exit 1
fi

# Every address this host answers on, so the certificate is still valid when
# someone reaches it by IP — this machine's lease has moved subnets before.
SAN="DNS:$HOST,IP:127.0.0.1"
[ "$HOST" = "localhost" ] || SAN="$SAN,DNS:localhost"
while read -r ip; do
  SAN="$SAN,IP:$ip"
done < <(
  { ip -4 -o addr show 2>/dev/null | awk '{print $4}' | cut -d/ -f1; } \
    | grep -v '^127\.' || true
)

mkdir -p certs
# 825 days and a subjectAltName are both hard requirements for Apple platforms
# to trust a certificate at all; a longer life or a bare CN is rejected outright
# by iPadOS, which is most of the devices this has to work on.
openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
  -keyout "$KEY" -out "$CRT" \
  -subj "/CN=$HOST" \
  -addext "subjectAltName=$SAN" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth" 2>/dev/null

chmod 600 "$KEY"
chmod 644 "$CRT"

echo "Wrote $KEY and $CRT"
openssl x509 -in "$CRT" -noout -subject -enddate -ext subjectAltName
echo
echo "Restart the app to pick it up:  systemctl --user restart grader.service"
