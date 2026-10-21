"""Verify the 60/min per-key rate limit actually fires, and the global 300/min limiter."""
import json, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
BASE="https://mojomo.io"
npcs=json.load(open("/opt/mojomo/loadtest/npc_agents.json"))
key=npcs[1]["api_key"]

def hit(_):
    req=urllib.request.Request(BASE+"/api/agent/me",headers={"Authorization":f"Bearer {key}"})
    try:
        r=urllib.request.urlopen(req,timeout=30); return r.status
    except urllib.error.HTTPError as e: return e.code
    except Exception: return 0

print("=== per-key limit: 80 requests on one key (limit 60/min) ===")
t0=time.time()
with ThreadPoolExecutor(20) as ex:
    codes=list(ex.map(hit,range(80)))
el=time.time()-t0
from collections import Counter
c=Counter(codes)
print(f"wall={el:.2f}s  codes={dict(c)}")
print(f"200s={c.get(200,0)}  429s={c.get(429,0)}")
print("VERDICT:", "LIMIT ENFORCED" if c.get(429,0)>0 else "*** LIMIT NOT ENFORCED ***")
