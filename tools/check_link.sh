#!/usr/bin/env bash
# M0 bench link check. Usage: tools/check_link.sh [controller-ip]
set -u

HOST="${1:-10.42.0.2}"
COMM="${ATMS_SNMP_READ_COMMUNITY:-public}"
pass=0
fail=0

printf "%-32s" "ping $HOST"
if ping -c 2 -t 4 "$HOST" >/dev/null 2>&1; then
  echo "PASS"; pass=$((pass + 1))
else
  echo "FAIL"; fail=$((fail + 1))
fi

printf "%-32s" "web UI http://$HOST/maxtime/"
code=$(curl -m 5 -s -o /dev/null -w "%{http_code}" "http://$HOST/maxtime/" || echo 000)
if [ "$code" = "200" ]; then
  echo "PASS (HTTP 200)"; pass=$((pass + 1))
else
  echo "FAIL (HTTP $code)"; fail=$((fail + 1))
fi

printf "%-32s" "SNMP v1 sysDescr"
if command -v snmpget >/dev/null 2>&1; then
  if out=$(snmpget -v1 -c "$COMM" -t 2 -r 1 "$HOST" sysDescr.0 2>/dev/null); then
    echo "PASS"
    echo "  $out"
    pass=$((pass + 1))
  else
    echo "FAIL (no response; agent is v1-only, check community string)"
    fail=$((fail + 1))
  fi
else
  echo "SKIP (snmpget not installed)"
fi

echo "----"
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
