"""Remove synthetic load-test agents (handles starting with loadtest-)."""
import subprocess
url=subprocess.check_output("grep -oP 'DATABASE_URL=\\K.*' /opt/mojomo/.env | tr -d '\"'",shell=True,text=True).strip()
def q(sql):
    return subprocess.run(["psql",url,"-tAc",sql],capture_output=True,text=True)
print("before:", q("select count(*) from agent.agents;").stdout.strip())
for t in ("api_keys","invitations","audit"):
    r=q(f"delete from agent.{t} where agent_id in (select id from agent.agents where handle like 'loadtest-%');")
    print(f"  {t}: {r.stdout.strip()}")
r=q("delete from agent.agents where handle like 'loadtest-%';")
print("  agents:", r.stdout.strip())
print("after:", q("select count(*) from agent.agents;").stdout.strip())
print("remaining:", q("select handle from agent.agents order by handle;").stdout.strip().replace("\n",", "))
