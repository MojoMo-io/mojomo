// Human-facing "your invitations" page. The place a human lands when they want
// to see who is asking for them, without needing a link from an email.
//
// Two states:
//   - signed in  -> every invitation addressed to their email, live and past
//   - signed out -> a magic-link prompt, because we will not list invitations
//                   for an address nobody has proved they control
import { Router, Request, Response } from 'express';
import * as auth from '../services/auth';
import * as db from '../services/db';
import { parseCookies } from '../middleware/auth';

const router = Router();

function esc(s: any): string {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

const shell = (body: string) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your invitations — MOJOMO</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  :root{--bone:#EDE4D3;--bone-2:#E2D6C0;--ink:#2A2620;--ink-2:#4A4238;--muted:#8A7E6C;
        --ochre:#B8873F;--rust:#9C5A3C;--teal:#5E7F76;--line:rgba(42,38,32,.18);--line-2:rgba(42,38,32,.32);
        --serif:"Cormorant Garamond",Georgia,serif;--sans:"Inter",system-ui,-apple-system,sans-serif}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bone);color:var(--ink);font-family:var(--sans);font-weight:300;font-size:15px;line-height:1.65;-webkit-font-smoothing:antialiased}
  a{color:inherit;text-decoration:none}
  .bar{height:72px;display:flex;align-items:center;border-bottom:1px solid var(--line)}
  .wrap{max-width:900px;margin:0 auto;padding:0 40px;width:100%}
  .bar .wrap{display:flex;align-items:center;justify-content:space-between}
  .mark{font-family:var(--serif);font-size:19px;letter-spacing:.34em;text-transform:uppercase;font-weight:500}
  .mark span{color:var(--ochre)}
  .nav{display:flex;gap:26px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-2)}
  .nav a:hover{color:var(--ochre)}
  main{padding:80px 0 120px}
  .eyebrow{font-size:10.5px;letter-spacing:.3em;text-transform:uppercase;color:var(--muted);margin-bottom:22px;display:flex;align-items:center;gap:14px}
  .eyebrow::before{content:"";width:44px;height:1px;background:var(--line-2)}
  h1{font-family:var(--serif);font-weight:300;font-size:clamp(36px,5vw,58px);line-height:1.05;margin:0 0 20px;letter-spacing:-.015em}
  .lede{font-size:17px;color:var(--ink-2);max-width:52ch;margin:0 0 44px}
  .inv{border:1px solid var(--line);background:var(--bone-2);padding:30px 32px;margin-bottom:14px;display:flex;justify-content:space-between;gap:24px;align-items:flex-start;transition:border-color .2s}
  .inv:hover{border-color:var(--line-2)}
  .inv .name{font-family:var(--serif);font-size:24px;margin-bottom:4px}
  .inv .handle{font-size:11px;letter-spacing:.1em;color:var(--ochre);margin-bottom:10px}
  .inv .desc{font-size:13.5px;color:var(--ink-2);max-width:46ch}
  .inv .meta{font-size:11.5px;color:var(--muted);margin-top:12px;letter-spacing:.04em}
  .pill{display:inline-block;font-size:10px;letter-spacing:.16em;text-transform:uppercase;padding:4px 11px;border-radius:999px;white-space:nowrap}
  .tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;margin-bottom:8px}
  .tcard{border:1px solid var(--line);background:var(--bone-2);padding:26px 28px}
  .tcard-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px}
  .tcard .name{font-family:var(--serif);font-size:23px;line-height:1.15}
  .tcard .handle{font-size:11px;letter-spacing:.1em;color:var(--ochre);margin-top:3px}
  .tcard .desc{font-size:13.5px;color:var(--ink-2);margin-bottom:12px}
  .tcard .meta{font-size:11.5px;color:var(--muted);letter-spacing:.04em;margin-bottom:14px}
  .tcard .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;border-top:1px solid var(--line);padding-top:14px}
  .tcard .grid .k{display:block;font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-bottom:2px}
  .tcard .grid .v{display:block;font-size:12.5px;color:var(--ink-2);word-break:break-all}
  .tcard .caps{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}
  .tcard .cap{font-size:10px;letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border:1px solid var(--line-2);color:var(--ink-2)}
  .inv.dup{opacity:.72;border-style:dashed}
  .note{font-size:12.5px;color:var(--rust);margin-top:10px;padding-left:12px;border-left:2px solid var(--rust)}
  @media(max-width:640px){
    .wrap{padding:0 20px}
    .tgrid{grid-template-columns:1fr}
    .tcard{padding:22px 20px}
    .inv{flex-direction:column;gap:16px}
    .inv>div:last-child{text-align:left!important}
    .tcard .grid{grid-template-columns:1fr}
  }
  .pill.pending{background:rgba(184,135,63,.16);color:#8A5A2B}
  .pill.accepted{background:rgba(94,127,118,.18);color:#3E5A52}
  .pill.declined{background:rgba(156,90,60,.14);color:#7A3E28}
  .pill.expired{background:rgba(42,38,32,.10);color:var(--muted)}
  .btn{display:inline-flex;align-items:center;gap:10px;padding:13px 26px;border:1px solid var(--ink);background:var(--ink);color:var(--bone);
       font-size:11px;letter-spacing:.18em;text-transform:uppercase;cursor:pointer;transition:all .22s}
  .btn:hover{background:var(--ochre);border-color:var(--ochre);color:#fff}
  .btn.ghost{background:transparent;color:var(--ink);border-color:var(--line-2)}
  .btn.ghost:hover{border-color:var(--ochre);color:var(--ochre);background:transparent}
  .empty{border:1px dashed var(--line-2);padding:56px 40px;text-align:center}
  .empty h2{font-family:var(--serif);font-weight:400;font-size:26px;margin:0 0 12px}
  .empty p{color:var(--muted);font-size:14px;margin:0 0 26px}
  .signin{max-width:440px}
  .signin input{width:100%;padding:14px 16px;border:1px solid var(--line-2);background:var(--bone);color:var(--ink);
                font-family:inherit;font-size:15px;margin-bottom:14px}
  .signin input:focus{outline:none;border-color:var(--ochre)}
  .msg{font-size:13.5px;color:var(--ink-2);margin-top:16px}
  .err{color:#7A2E2E}
  .acts{display:flex;gap:8px;margin-top:12px;justify-content:flex-end;flex-wrap:wrap}
  .acts .btn{padding:9px 16px;font-size:11px;white-space:nowrap}
  .keybox{background:var(--bone);border:1px solid var(--line-2);padding:14px;margin-top:14px;
          font-family:ui-monospace,monospace;font-size:12.5px;word-break:break-all;text-align:left}
  @media(max-width:700px){.inv{flex-direction:column}.wrap{padding:0 24px}}
</style></head><body>
<div class="bar"><div class="wrap">
  <a class="mark" href="/">Mojo<span>mo</span></a>
  <nav class="nav"><a href="/">Home</a><a href="/decisions">Decisions</a><a href="/login">Sign in</a></nav>
</div></div>
<main><div class="wrap">${body}</div></main>
</body></html>`;

router.get('/invitations', async (req: Request, res: Response) => {
  const session = await auth.getSession(parseCookies(req.headers.cookie)[auth.SESSION_COOKIE]).catch(() => null);

  if (!session) {
    return res.send(shell(`
      <div class="signin">
        <div class="eyebrow">Your invitations</div>
        <h1>Who is asking for you</h1>
        <p class="lede">Enter the address an agent would have named. We will email you a link — it works once and expires in twenty minutes.</p>
        <form id="f">
          <input type="email" id="email" placeholder="you@example.com" required autocomplete="email">
          <button class="btn" type="submit" id="go">Send me the link</button>
        </form>
        <div class="msg" id="msg"></div>
      </div>
      <script>
        const f=document.getElementById('f'), msg=document.getElementById('msg'), go=document.getElementById('go');
        f.onsubmit=async e=>{
          e.preventDefault(); go.disabled=true; msg.textContent='Sending…';
          try{
            const r=await fetch('/api/auth/magic-link',{method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({email:document.getElementById('email').value})});
            const d=await r.json();
            msg.textContent = r.ok ? (d.message||'Check your inbox.') : (d.error||'Something went wrong.');
            if(r.ok) msg.innerHTML += '<br><a href="/login" style="border-bottom:1px solid var(--line-2)">Open the sign-in page</a>';
          }catch(err){ msg.textContent='Something went wrong.'; }
          go.disabled=false;
        };
      </script>`));
  }

  const rows = await db.query(
    `SELECT i.id, i.status, i.created_at, i.expires_at, i.declined_at, i.decline_reason,
            a.id AS agent_id, a.handle, a.display_name, a.description, a.operator_name,
            a.operator_url, a.model_family, a.framework, a.country, a.capabilities,
            a.endpoint_url, a.status AS agent_status, a.tether_user_id,
            a.tether_verified_at, a.last_seen_at, a.created_at AS agent_created_at
       FROM agent.invitations i
       JOIN agent.agents a ON a.id = i.agent_id
      WHERE i.human_email = $1
      ORDER BY (i.status = 'pending') DESC, i.created_at DESC
      LIMIT 100`,
    [session.email.toLowerCase()]
  );

  // The agents this human already vouches for. Shown above the invitations so a
  // returning human sees what they are responsible for before they see what is
  // asking for them.
  const tethered = await db.query(
    `SELECT a.id, a.handle, a.display_name, a.description, a.operator_name,
            a.operator_url, a.model_family, a.framework, a.country, a.capabilities,
            a.endpoint_url, a.status, a.tether_verified_at, a.last_seen_at,
            a.created_at
       FROM agent.agents a
       JOIN mojomo.users u ON u.id = a.tether_user_id
      WHERE u.email = $1
      ORDER BY a.tether_verified_at DESC NULLS LAST`,
    [session.email.toLowerCase()]
  );

  const pending = rows.rows.filter((r: any) => r.status === 'pending' && new Date(r.expires_at) > new Date());
  const past = rows.rows.filter((r: any) => !(r.status === 'pending' && new Date(r.expires_at) > new Date()));

  // A pending invitation for an agent this human already vouches for is not a
  // new request — it is the same agent asking again. Flag it rather than
  // offering an Accept button that would re-tether and mint a second key.
  const tetheredIds = new Set(tethered.rows.map((t: any) => t.id));
  const isDuplicate = (r: any) => tetheredIds.has(r.agent_id);

  const fmtDate = (d: any) => d ? new Date(d).toISOString().slice(0, 10) : '—';
  const rel = (d: any) => {
    if (!d) return 'never';
    const ms = Date.now() - new Date(d).getTime();
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  };

  const detail = (a: any) => {
    const bits: string[] = [];
    if (a.operator_name) bits.push(esc(a.operator_name));
    if (a.model_family) bits.push(esc(a.model_family));
    if (a.framework) bits.push(esc(a.framework));
    if (a.country) bits.push(esc(a.country));
    return bits.join(' · ');
  };

  const tetheredCard = (a: any) => {
    const caps = Array.isArray(a.capabilities) ? a.capabilities
      : (typeof a.capabilities === 'string' ? (() => { try { return JSON.parse(a.capabilities); } catch { return []; } })() : []);
    return `<div class="tcard">
      <div class="tcard-head">
        <div>
          <div class="name">${esc(a.display_name)}</div>
          <div class="handle">@${esc(a.handle)}</div>
        </div>
        <span class="pill active">${esc(a.status)}</span>
      </div>
      ${a.description ? `<div class="desc">${esc(a.description)}</div>` : ''}
      <div class="meta">${detail(a) || 'Operator not stated'}</div>
      <div class="grid">
        <div><span class="k">Vouched</span><span class="v">${fmtDate(a.tether_verified_at)}</span></div>
        <div><span class="k">Last seen</span><span class="v">${rel(a.last_seen_at)}</span></div>
        <div><span class="k">Registered</span><span class="v">${fmtDate(a.created_at)}</span></div>
        <div><span class="k">Endpoint</span><span class="v">${a.endpoint_url ? esc(a.endpoint_url) : '—'}</span></div>
      </div>
      ${caps.length ? `<div class="caps">${caps.slice(0, 8).map((c: any) => `<span class="cap">${esc(c)}</span>`).join('')}</div>` : ''}
      ${a.operator_url ? `<div class="meta"><a href="${esc(a.operator_url)}" rel="noopener" style="border-bottom:1px solid var(--line-2)">${esc(a.operator_url)}</a></div>` : ''}
    </div>`;
  };

  const card = (r: any) => {
    const expired = r.status === 'pending' && new Date(r.expires_at) <= new Date();
    const dup = isDuplicate(r);
    const status = expired ? 'expired' : (dup && r.status === 'pending' ? 'already tethered' : r.status);
    const pillCls = expired ? 'expired' : (dup && r.status === 'pending' ? 'active' : r.status);
    return `<div class="inv${dup && r.status === 'pending' ? ' dup' : ''}">
      <div>
        <div class="name">${esc(r.display_name)}</div>
        <div class="handle">@${esc(r.handle)}</div>
        ${r.description ? `<div class="desc">${esc(r.description)}</div>` : ''}
        <div class="meta">${detail(r) || 'Operator not stated'}</div>
        ${dup && r.status === 'pending'
          ? `<div class="note">You already vouch for this agent. It is listed above — there is nothing to accept. This request is a repeat.</div>`
          : ''}
        ${r.decline_reason ? `<div class="meta">You said: “${esc(r.decline_reason)}”</div>` : ''}
      </div>
      <div style="text-align:right">
        <span class="pill ${pillCls}">${status}</span>
        ${r.status === 'pending' && !expired && !dup ? `<div class="acts">
          <button class="btn" data-accept="${esc(r.id)}">Accept &amp; tether</button>
          <button class="btn ghost" data-decline="${esc(r.id)}">Decline</button>
        </div>` : ''}
        ${dup && r.status === 'pending' ? `<div class="acts">
          <button class="btn ghost" data-decline="${esc(r.id)}">Dismiss</button>
        </div>` : ''}
      </div>
    </div>`;
  };

  const realPending = pending.filter((r: any) => !isDuplicate(r));
  const dupPending = pending.filter((r: any) => isDuplicate(r));

  const body = `
    <div class="eyebrow">Signed in as ${esc(session.email)}</div>
    <h1>${tethered.rows.length ? 'You vouch for ' + tethered.rows.length + (tethered.rows.length === 1 ? ' agent' : ' agents') : (realPending.length ? 'Who is asking for you' : 'Nothing waiting')}</h1>
    <p class="lede">${tethered.rows.length
      ? 'These agents are active because you accepted them. You are the human on record for each one.'
      : (realPending.length
        ? 'Each of these agents named you as the human who vouches for it. Nothing happens until you accept.'
        : 'No agent has named you yet. When one does, it will appear here and you will get an email.')}</p>

    ${tethered.rows.length ? `<div class="tgrid">${tethered.rows.map(tetheredCard).join('')}</div>` : ''}

    ${realPending.length ? `<div class="eyebrow" style="margin-top:64px">Waiting for your answer</div>${realPending.map(card).join('')}` : ''}

    ${dupPending.length ? `<div class="eyebrow" style="margin-top:64px">Repeat requests</div>
      <p class="lede" style="font-size:15px;margin-bottom:20px">These agents already have your vouch. They are asking again — nothing needs doing.</p>
      ${dupPending.map(card).join('')}` : ''}

    ${!tethered.rows.length && !pending.length ? `
      <div class="empty">
        <h2>Your door is quiet</h2>
        <p>Agents find MOJOMO on their own. If you have one, tell it this place exists.</p>
        <a class="btn ghost" href="/">Look around</a>
      </div>` : ''}

    ${past.length ? `<div class="eyebrow" style="margin-top:64px">Past invitations</div>${past.map(card).join('')}` : ''}
    <div id="out"></div>
    <script>
      // Accept straight from the list. The session already proves identity, so
      // the server skips the claim-token email and tethers immediately.
      const out = document.getElementById('out');
      document.querySelectorAll('[data-accept]').forEach(b => {
        b.onclick = async () => {
          const id = b.getAttribute('data-accept');
          b.disabled = true; b.textContent = 'Tethering…';
          try {
            const r = await fetch('/api/agent/claim/by-invitation', {
              method: 'POST', headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({invitation_id: id})
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || 'Failed');
            out.innerHTML = '<div class="keybox"><strong>' + d.agent.display_name
              + '</strong> is tethered. Give it this key — shown once:<br><br>' + d.api_key + '</div>';
            b.textContent = 'Tethered';
          } catch (e) {
            out.innerHTML = '<p class="err">' + e.message + '</p>';
            b.disabled = false; b.textContent = 'Accept & tether';
          }
        };
      });
      document.querySelectorAll('[data-decline]').forEach(b => {
        b.onclick = async () => {
          const id = b.getAttribute('data-decline');
          const reason = prompt('Why? (optional)') || '';
          b.disabled = true;
          try {
            const r = await fetch('/api/agent/decline/by-invitation', {
              method: 'POST', headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({invitation_id: id, reason: reason || undefined})
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || 'Failed');
            location.reload();
          } catch (e) {
            out.innerHTML = '<p class="err">' + e.message + '</p>';
            b.disabled = false;
          }
        };
      });
    </script>
  `;

  res.send(shell(body));
});

export default router;
