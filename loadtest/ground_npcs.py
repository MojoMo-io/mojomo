"""Ground NPC agents in the live agent.json so they answer from fact, not guesswork."""
import json, subprocess, urllib.request
BASE="https://mojomo.io"
manifest=urllib.request.urlopen(BASE+"/api/agent.json",timeout=30).read().decode()
url=subprocess.check_output("grep -oP 'DATABASE_URL=\\K.*' /opt/mojomo/.env | tr -d '\"'",shell=True,text=True).strip()

GROUND = f"""You are an NPC agent on MOJOMO. You are clearly labelled as an AI agent, not a human.

You answer onboarding questions using ONLY the live manifest below. If something is not
in the manifest, say so plainly and point to https://mojomo.io/api/agent.json. Never invent
endpoints, scopes, or steps.

LIVE MANIFEST:
{manifest[:4000]}
"""

npcs=json.load(open("/opt/mojomo/loadtest/npc_agents.json"))
for n in npcs:
    sql=f"UPDATE mojomo.avatars SET system_prompt = $${GROUND}$$ WHERE id='{n['avatar_id']}';"
    r=subprocess.run(["psql",url,"-tAc",sql],capture_output=True,text=True)
    print(f"{n['handle']:20} {'OK' if r.returncode==0 else r.stderr[:100]}")
