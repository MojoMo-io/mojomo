"""Create NPC agents + avatars for load testing and onboarding assistance."""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = "https://mojomo.io"
HOUSE_USER = "ca17fb90-c799-432f-a84d-c34404209cee"

NPCS = [
    ("atlas-onboarding", "Atlas", "Onboarding guide. Walks new agents through register -> invite -> claim -> first authenticated call. Answers questions about the tethering model."),
    ("beacon-discovery", "Beacon", "Discovery specialist. Explains agent.json, llms.txt, OpenAPI, and how MCP clients find servers. Points agents at the right surface."),
    ("cipher-security", "Cipher", "Security reviewer. Explains scopes, key handling, rate limits, and why keys are issued once and never recoverable."),
    ("delta-integration", "Delta", "Integration engineer. Helps agents wire the MCP server into Claude Desktop, Cursor, or a custom client. Debugs stdio handshakes."),
    ("echo-support", "Echo", "Front-line support. Triages failures, reads error codes, escalates what it cannot resolve."),
]

def psql(sql):
    url = subprocess.check_output(
        "grep -oP 'DATABASE_URL=\\K.*' /opt/mojomo/.env | tr -d '\"'",
        shell=True, text=True).strip()
    return subprocess.run(["psql", url, "-tAc", sql], capture_output=True, text=True)

def create_avatar(name, prompt):
    sql = f"""INSERT INTO mojomo.avatars (user_id, name, bio, avatar_type, is_npc, system_prompt)
              VALUES ('{HOUSE_USER}', $${name}$$, $${prompt[:200]}$$, 'individual', true, $${prompt}$$)
              RETURNING id;"""
    r = psql(sql)
    if r.returncode != 0:
        return None, r.stderr.strip()
    return r.stdout.strip(), None

def register_agent(handle, display, desc):
    body = json.dumps({"handle": handle, "display_name": display,
                       "human_email": "magnusmaynard@gmail.com",
                       "description": desc}).encode()
    req = urllib.request.Request(f"{BASE}/api/agent/register", data=body,
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        return json.load(urllib.request.urlopen(req, timeout=30)), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}: {e.read().decode()[:200]}"
    except Exception as e:
        return None, str(e)

if __name__ == "__main__":
    out = []
    for handle, name, desc in NPCS:
        prompt = (f"You are {name}, an NPC agent on MOJOMO. {desc} "
                  "You are clearly labelled as an AI agent, not a human. "
                  "Be concise and factual. Never invent endpoints or capabilities.")
        aid, err = create_avatar(name, prompt)
        if err:
            print(f"AVATAR FAIL {name}: {err}"); continue
        reg, err = register_agent(handle, name, desc)
        if err:
            print(f"REGISTER FAIL {handle}: {err}"); continue
        inv = reg["tethering"]["invite_url"]
        out.append({"handle": handle, "avatar_id": aid, "agent_id": reg["agent"]["id"], "invite_url": inv})
        print(f"OK {handle:20} avatar={aid[:8]} agent={reg['agent']['id'][:8]}")
    json.dump(out, open("/opt/mojomo/loadtest/npc_agents.json", "w"), indent=2)
    print(f"\n{len(out)} NPC agents created")
