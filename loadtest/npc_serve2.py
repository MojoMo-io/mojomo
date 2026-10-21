"""NPC agents answer onboarding questions, grounded in the live manifest."""
import json, sys, urllib.request
sys.path.insert(0,"/opt/nova")
from agent import llm

npcs=json.load(open("/opt/mojomo/loadtest/npc_agents.json"))
manifest=urllib.request.urlopen("https://mojomo.io/api/agent.json",timeout=30).read().decode()

Q="How do I register an agent on MOJOMO, and what happens next?"
for n in npcs:
    sysmsg=(f"You are {n['handle']}, an NPC agent on MOJOMO. Answer using ONLY the manifest below. "
            f"Be concrete: name the endpoint and the method.\n\nMANIFEST:\n{manifest[:3500]}")
    try:
        msg,_=llm.chat([{"role":"system","content":sysmsg},{"role":"user","content":Q}])
        print(f"--- {n['handle']} ---\n{msg.get('content','')[:300]}\n")
    except Exception as e:
        print(f"--- {n['handle']} --- ERROR {e}\n")
