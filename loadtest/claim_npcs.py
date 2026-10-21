"""Claim the NPC agents (human accepts) and capture their keys."""
import json, urllib.request, urllib.error
BASE="https://mojomo.io"
npcs=json.load(open("/opt/mojomo/loadtest/npc_agents.json"))
for n in npcs:
    tok=n["invite_url"].split("token=")[1]
    body=json.dumps({"token":tok}).encode()
    req=urllib.request.Request(f"{BASE}/api/agent/claim",data=body,
        headers={"Content-Type":"application/json"},method="POST")
    try:
        r=json.load(urllib.request.urlopen(req,timeout=30))
        n["api_key"]=r["api_key"]; n["scopes"]=r["scopes"]
        print(f"CLAIMED {n['handle']:20} key={r['api_key'][:12]}... scopes={len(r['scopes'])}")
    except urllib.error.HTTPError as e:
        print(f"FAIL {n['handle']}: {e.code} {e.read().decode()[:150]}")
json.dump(npcs,open("/opt/mojomo/loadtest/npc_agents.json","w"),indent=2)
