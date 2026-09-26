#!/bin/bash
# TradePulse verification: login (demo) + run scans + check key stocks.
set -e
BASE=http://localhost:3000
JAR=/tmp/tp-cookies.txt

echo "== csrf =="
CSRF=$(curl -s -c "$JAR" "$BASE/api/auth/csrf" | sed 's/.*"csrfToken":"\([^"]*\)".*/\1/')
echo "csrf: ${CSRF:0:12}…"

echo "== login (demo one-tap) =="
curl -s -b "$JAR" -c "$JAR" -o /dev/null -w "login HTTP %{http_code}\n" \
  -X POST "$BASE/api/auth/callback/credentials" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "demo=1"

echo "== session =="
curl -s -b "$JAR" "$BASE/api/auth/session" | head -c 200; echo

echo "== catalog =="
curl -s -b "$JAR" "$BASE/api/scanners" | python3 -c "
import json,sys
d = json.load(sys.stdin)
groups = d.get('groups', [])
total = sum(len(g['scans']) for g in groups)
print('categories:', len(groups), '| scans:', total)
tc = next((g for g in groups if g['category'] == 'Trader Choice'), None)
print('Trader Choice:', [s['id'] for s in tc['scans']] if tc else 'MISSING')
"

run_scan () {
  local id="$1"
  local want="$2"
  echo "== scan: $id =="
  curl -s -b "$JAR" -X POST "$BASE/api/scanners/$id" | python3 -c "
import json,sys
d = json.load(sys.stdin)
if 'error' in d: print('ERROR:', d['error']); sys.exit(0)
rows = d.get('rows', [])
print('rows:', len(rows), '| scanned:', d.get('scanned'))
syms = [r['symbol'].replace('.NS','') for r in rows]
for want in '$want'.split(','):
    if want:
        print(f'  {want}:', 'FOUND' if want in syms else 'not in output')
if rows:
    r0 = rows[0]
    print('  top:', r0['symbol'], '| RS', r0.get('rs'), '| EPS', r0.get('epsScore'), '| AD', r0.get('adRating'), '| epsChg', r0.get('epsChgYoy'))
    print('  columns:', [c['key'] for c in d.get('columns', [])])
"
}

run_scan "trader-choice-5" "SHANTIGOLD,ARTEMISMED,GNA"
run_scan "trader-choice-7" ""
