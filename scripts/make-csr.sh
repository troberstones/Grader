#!/usr/bin/env bash
# Generate a certificate signing request to hand to CS IT / the campus CA.
#
# A CSR rather than "please send us a certificate and key": the private key is
# created here and never leaves this host, so nobody has to email one around
# and there is no copy of it in a ticket system. The CSR itself is public — it
# is safe to paste into a ticket.
#
#   ./scripts/make-csr.sh                       # for $(hostname -f)
#   ./scripts/make-csr.sh cs-1017245.cs.byu.edu
#
# Only the DNS name goes in. Public CAs are forbidden by the CA/Browser Forum
# baseline requirements from issuing for private addresses or for "localhost",
# so asking for 10.52.3.52 would get the whole request rejected rather than
# trimmed. The consequence is worth knowing: once a CA-issued certificate is
# in place, reaching the app by IP will warn again. Use the hostname.
#
# When the signed certificate comes back:
#
#   cat issued.crt intermediate.crt > certs/server.crt   # leaf FIRST, then chain
#   cp certs/request.key certs/server.key && chmod 600 certs/server.key
#   systemctl --user restart grader.service
#
# The chain order matters and the omission is a classic: Node serves exactly
# the bytes in `cert`, so a missing intermediate validates on a desktop that
# has it cached and fails on an iPad that does not.
set -euo pipefail

cd "$(dirname "$0")/.."

HOST="${1:-$(hostname -f 2>/dev/null || hostname)}"
KEY=certs/request.key
CSR=certs/request.csr

mkdir -p certs
if [ -e "$KEY" ]; then
  echo "$KEY already exists — reusing it, so an earlier request stays valid." >&2
else
  openssl genrsa -out "$KEY" 2048 2>/dev/null
  chmod 600 "$KEY"
fi

openssl req -new -key "$KEY" -out "$CSR" \
  -subj "/CN=$HOST" \
  -addext "subjectAltName=DNS:$HOST" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth"

echo "Wrote $KEY (keep, never send) and $CSR (safe to send)"
echo
openssl req -in "$CSR" -noout -subject -reqopt no_version -text | grep -A2 "Subject:\|Alternative"
echo
echo "--- paste everything below into the ticket ---"
cat "$CSR"
