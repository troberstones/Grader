#!/usr/bin/env bash
# Kill every Next dev server, then prove the port is actually free.
#
# Two servers splitting port 3000 — one holding IPv4, one holding IPv6 — looks
# perfectly healthy from localhost (which resolves to ::1) and fails from every
# other device on the LAN. So list before and after rather than trusting it.

echo "holding port 3000:"
lsof -nP -iTCP:3000 -sTCP:LISTEN || echo "  nothing"

pkill -f next-server
sleep 2

echo
echo "after:"
lsof -nP -iTCP:3000 -sTCP:LISTEN || echo "  port 3000 free"
