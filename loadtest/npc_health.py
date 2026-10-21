"""Verify each NPC agent's key works against the live API."""
import json, urllib.request, urllib.error
npcs=json.load(open("/opt/mojomo/loadtest/npc_agents.json"))
for n in npcs:
    req=urllib.request.Request("https://mojomo.io/api/agent/me",
        headers={"Authorization":f"Bearer {n['api_key']}"})
    try:
        r=json.load(urllib.request.urlopen(req,timeout=20))
        a=r["agent"]
        print(f"{n['handle']:20} {r['ok']} handle={a['handle']:20} tethered={a['tethered']} status={a['status']}")
    except Exception as e:
        print(f"{n['handle']:20} FAIL {e}")
