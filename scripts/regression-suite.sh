#!/bin/bash
# Full regression: every scan must return 200 with rows.
BASE=http://localhost:3000
JAR=/tmp/tp-cookies.txt
CSRF=$(curl -s -c "$JAR" "$BASE/api/auth/csrf" | sed 's/.*"csrfToken":"\([^"]*\)".*/\1/')
curl -s -b "$JAR" -c "$JAR" -o /dev/null -X POST "$BASE/api/auth/callback/credentials" \
  -H "Content-Type: application/x-www-form-urlencoded" --data-urlencode "csrfToken=$CSRF" --data-urlencode "demo=1"

curl -s -b "$JAR" "$BASE/api/scanners" | python3 -c "
import json,sys
d = json.load(sys.stdin)
for g in d.get('groups', []):
    for s in g['scans']:
        print(s['id'])
" > /tmp/scan-ids.txt

echo "scans: $(wc -l < /tmp/scan-ids.txt)"
PASS=0; FAIL=0
while read -r id; do
  RES=$(curl -s -b "$JAR" -o /tmp/scan-out.json -w "%{http_code}" -X POST "$BASE/api/scanners/$id")
  ROWS=$(python3 -c "import json; d=json.load(open('/tmp/scan-out.json')); print(len(d.get('rows',[])))" 2>/dev/null || echo "?")
  if [ "$RES" = "200" ]; then
    PASS=$((PASS+1)); printf "  ✓ %-24s %s rows\n" "$id" "$ROWS"
  else
    FAIL=$((FAIL+1)); printf "  ✗ %-24s HTTP %s\n" "$id" "$RES"
  fi
done < /tmp/scan-ids.txt
echo "PASS: $PASS | FAIL: $FAIL"

echo "== builder: daily dayLow < 2100 =="
curl -s -b "$JAR" "$BASE/api/stocks?cond=%5B%7B%22f%22%3A%22dayLow%22%2C%22op%22%3A%22lt%22%2C%22v%22%3A%222100%22%7D%5D&perPage=3" | python3 -c "import json,sys; d=json.load(sys.stdin); print('total:', d.get('total'), '| err:', d.get('error'))"
echo "== builder: weekly wLow < 2100 =="
curl -s -b "$JAR" "$BASE/api/stocks?cond=%5B%7B%22f%22%3A%22wLow%22%2C%22op%22%3A%22lt%22%2C%22v%22%3A%222100%22%7D%5D&perPage=3" | python3 -c "import json,sys; d=json.load(sys.stdin); print('total:', d.get('total'), '| err:', d.get('error'))"
echo "== builder: open > 500 AND weekly close > 1000 =="
curl -s -b "$JAR" "$BASE/api/stocks?cond=%5B%7B%22f%22%3A%22open%22%2C%22op%22%3A%22gt%22%2C%22v%22%3A%22500%22%7D%2C%7B%22f%22%3A%22wClose%22%2C%22op%22%3A%22gt%22%2C%22v%22%3A%221000%22%7D%5D&perPage=3" | python3 -c "import json,sys; d=json.load(sys.stdin); print('total:', d.get('total'), '| err:', d.get('error'))"
echo "== builder: wHigh between 2000-2200 =="
curl -s -b "$JAR" "$BASE/api/stocks?cond=%5B%7B%22f%22%3A%22wHigh%22%2C%22op%22%3A%22between%22%2C%22v%22%3A%222000%22%2C%22v2%22%3A%222200%22%7D%5D&perPage=3" | python3 -c "import json,sys; d=json.load(sys.stdin); print('total:', d.get('total'), '| err:', d.get('error'))"
