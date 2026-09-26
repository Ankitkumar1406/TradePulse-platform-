#!/usr/bin/env python3
"""E2E: run the user's Chartink-style pro screen through the live /api/stocks API."""
import json, time, urllib.parse, urllib.request

BASE = "http://localhost:3000"
COOKIES = open("/tmp/cookies.txt").read()

def cookie_header():
    jar = {}
    for line in COOKIES.splitlines():
        if not line.strip():
            continue
        # curl marks HttpOnly cookies with a "#HttpOnly_" prefix — keep them
        if line.startswith("#HttpOnly_"):
            line = line[len("#HttpOnly_"):]
        elif line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) >= 7:
            jar[parts[5]] = parts[6]  # last occurrence wins
    return "; ".join(f"{k}={v}" for k, v in jar.items())

rows = [
    {"kind": "expr", "cmp": "gte", "l": "close / min(66, low)", "r": "1.30", "logic": "and"},
    {"f": "marketCap", "op": "gt", "v": 0, "logic": "and"},
    {"f": "price", "op": "gte", "v": 1, "logic": "and"},
    {"kind": "expr", "cmp": "gt", "l": "close * sma(volume, 20)", "r": "30000000", "logic": "and"},
    {"kind": "expr", "cmp": "gt", "l": "close", "r": "sma(close, 200)", "logic": "and"},
    {"kind": "expr", "cmp": "lte", "l": "abs(1 week ago ((close - 1 candle ago close) / 1 candle ago close * 100))", "r": "6", "logic": "and"},
    {"kind": "expr", "cmp": "lte", "l": "abs(2 weeks ago ((close - 1 candle ago close) / 1 candle ago close * 100))", "r": "6", "logic": "and"},
    {"kind": "expr", "cmp": "lte", "l": "abs(3 weeks ago ((close - 1 candle ago close) / 1 candle ago close * 100))", "r": "6", "logic": "and"},
    {"kind": "expr", "cmp": "lt", "l": "1 week ago close", "r": "2 weeks ago high", "logic": "and"},
    {"kind": "expr", "cmp": "gte", "l": "weekly high", "r": "1 week ago high", "logic": "and"},
    {"kind": "expr", "cmp": "gte", "l": "weekly high", "r": "2 weeks ago high", "logic": "and"},
    {"kind": "expr", "cmp": "gte", "l": "weekly high", "r": "3 weeks ago high", "logic": "and"},
    {"kind": "expr", "cmp": "gte", "l": "weekly high", "r": "4 weeks ago high", "logic": "and"},
]

def get(path):
    req = urllib.request.Request(BASE + path, headers={"Cookie": cookie_header()})
    t0 = time.time()
    with urllib.request.urlopen(req) as res:
        data = json.loads(res.read())
    return data, (time.time() - t0) * 1000

# 1. pro screen
cond = urllib.parse.quote(json.dumps(rows))
path = f"/api/stocks?cond={cond}&sector=all&sort=marketCap&dir=desc&page=1&perPage=25"
data, ms = get(path)
print(f"pro screen: {ms:.0f}ms total={data.get('total')} condCount={data.get('condCount')} rows={len(data.get('stocks', []))}")
for s in data.get("stocks", [])[:6]:
    print("  ", s["symbol"].replace(".NS", ""), s["price"], "relVol=", round(s["relVol"], 2) if s.get("relVol") else None)

# 2. cached second page fetch (server cache makes this fast)
path2 = f"/api/stocks?cond={cond}&sector=all&sort=marketCap&dir=desc&page=2&perPage=25"
data2, ms2 = get(path2)
print(f"page 2: {ms2:.0f}ms total={data2.get('total')} rows={len(data2.get('stocks', []))}")

# 3. sector filter + pro
path3 = f"/api/stocks?cond={cond}&sector=Pharmaceuticals&sort=marketCap&dir=desc&page=1&perPage=25"
data3, ms3 = get(path3)
print(f"pharma only: {ms3:.0f}ms total={data3.get('total')}")

# 4. fast path still works (field rows only)
fast = [{"f": "rsi14", "op": "gt", "v": 60}, {"f": "aboveSma200", "op": "eq", "v": True, "logic": "or"}]
condf = urllib.parse.quote(json.dumps(fast))
data4, ms4 = get(f"/api/stocks?cond={condf}&sector=all&sort=marketCap&dir=desc&page=1&perPage=25")
print(f"fast path (field rows): {ms4:.0f}ms total={data4.get('total')} condCount={data4.get('condCount')}")

# 5. bad expression → 400 with row message
bad = [{"kind": "expr", "cmp": "gte", "l": "cloze +", "r": "1"}]
condb = urllib.parse.quote(json.dumps(bad))
req = urllib.request.Request(BASE + f"/api/stocks?cond={condb}&sector=all&sort=marketCap&dir=desc&page=1&perPage=25", headers={"Cookie": cookie_header()})
try:
    urllib.request.urlopen(req)
    print("bad expr: ✗ should have 400'd")
except urllib.error.HTTPError as e:
    body = json.loads(e.read())
    print(f"bad expr: {e.code} → {body.get('error')}")

# 6. saved screen roundtrip with an expr row
payload = json.dumps({"name": "Pro test · 66d breakout", "kind": "conditions", "definition": {"rows": rows}}).encode()
req = urllib.request.Request(BASE + "/api/screens", data=payload, headers={"Cookie": cookie_header(), "Content-Type": "application/json"}, method="POST")
with urllib.request.urlopen(req) as res:
    saved = json.loads(res.read())
print("saved screen:", saved.get("screen", {}).get("id"), "kind:", saved.get("screen", {}).get("kind"))
# cleanup
sid = saved.get("screen", {}).get("id")
req = urllib.request.Request(BASE + f"/api/screens?id={sid}", headers={"Cookie": cookie_header()}, method="DELETE")
urllib.request.urlopen(req)
print("deleted saved screen ✓")
