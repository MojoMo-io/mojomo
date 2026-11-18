"""Load test: registration throughput + authenticated read throughput."""
import json, time, urllib.request, urllib.error, statistics, sys
from concurrent.futures import ThreadPoolExecutor

BASE="https://mojomo.io"

def call(method, path, body=None, key=None, timeout=30):
    data=json.dumps(body).encode() if body else None
    h={"Content-Type":"application/json"}
    if key: h["Authorization"]=f"Bearer {key}"
    req=urllib.request.Request(BASE+path,data=data,headers=h,method=method)
    t0=time.time()
    try:
        r=urllib.request.urlopen(req,timeout=timeout)
        return r.status, time.time()-t0, r.read()
    except urllib.error.HTTPError as e:
        return e.code, time.time()-t0, e.read()
    except Exception as e:
        return 0, time.time()-t0, str(e).encode()

def register(i):
    return call("POST","/api/agent/register",{
        "handle":f"loadtest-{i}-{int(time.time())}",
        "display_name":f"Load Test {i}",
        "human_email":"loadtest@example.com",
        "description":"synthetic load test agent"})

def authed(key, path):
    return call("GET",path,key=key)

def summarize(label, results):
    codes={}
    for c,_,_ in results: codes[c]=codes.get(c,0)+1
    lat=[t for c,t,_ in results if c==200]
    if lat:
        lat.sort()
        print(f"{label:28} n={len(results):4} ok={codes.get(200,0):4} "
              f"p50={statistics.median(lat)*1000:6.0f}ms p95={lat[int(len(lat)*0.95)-1]*1000:6.0f}ms "
              f"max={max(lat)*1000:6.0f}ms codes={codes}")
    else:
        print(f"{label:28} n={len(results):4} ok=0 codes={codes}")

if __name__=="__main__":
    npcs=json.load(open("/opt/mojomo/loadtest/npc_agents.json"))
    key=npcs[0]["api_key"]

    print("=== PHASE 1: registration throughput (no auth) ===")
    for conc in (5,10,20):
        t0=time.time()
        with ThreadPoolExecutor(conc) as ex:
            res=list(ex.map(register,range(conc*2)))
        el=time.time()-t0
        summarize(f"register conc={conc}",res)
        print(f"{'':28} wall={el:.2f}s  rps={len(res)/el:.1f}")

    print("\n=== PHASE 2: authenticated reads (60/min limit per key) ===")
    for conc in (5,10):
        t0=time.time()
        with ThreadPoolExecutor(conc) as ex:
            res=list(ex.map(lambda _: authed(key,"/api/agent/me"),range(conc*3)))
        el=time.time()-t0
        summarize(f"agent/me conc={conc}",res)
        print(f"{'':28} wall={el:.2f}s  rps={len(res)/el:.1f}")

    print("\n=== PHASE 3: discovery surfaces (unauthenticated) ===")
    for path in ("/api/agent.json","/api/llms.txt","/openapi.json"):
        with ThreadPoolExecutor(10) as ex:
            res=list(ex.map(lambda _: call("GET",path),range(20)))
        summarize(path,res)
