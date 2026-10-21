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
  @media(max-width:700px){.inv{flex-direction:column}.wrap{padding:0 24px}}
</style></head><body>
<div class="bar"><div class="wrap">
  <a class="mark" href="/">Mojo<span>mo</span></a>
  <nav class="nav"><a href="/">Home</a><a href="/login">Sign in</a></nav>
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
            a.handle, a.display_name, a.description, a.operator_name, a.model_family
       FROM agent.invitations i
       JOIN agent.agents a ON a.id = i.agent_id
      WHERE i.human_email = $1
      ORDER BY (i.status = 'pending') DESC, i.created_at DESC
      LIMIT 100`,
    [session.email.toLowerCase()]
  );

  const pending = rows.rows.filter((r: any) => r.status === 'pending' && new Date(r.expires_at) > new Date());
  const past = rows.rows.filter((r: any) => !(r.status === 'pending' && new Date(r.expires_at) > new Date()));

  const card = (r: any) => {
    const expired = r.status === 'pending' && new Date(r.expires_at) <= new Date();
    const status = expired ? 'expired' : r.status;
    return `<div class="inv">
      <div>
        <div class="name">${esc(r.display_name)}</div>
        <div class="handle">@${esc(r.handle)}</div>
        ${r.description ? `<div class="desc">${esc(r.description)}</div>` : ''}
        <div class="meta">${esc(r.operator_name || 'Operator not stated')}${r.model_family ? ' · ' + esc(r.model_family) : ''}</div>
        ${r.decline_reason ? `<div class="meta">You said: “${esc(r.decline_reason)}”</div>` : ''}
      </div>
      <div style="text-align:right">
        <span class="pill ${status}">${status}</span>
      </div>
    </div>`;
  };

  const body = `
    <div class="eyebrow">Signed in as ${esc(session.email)}</div>
    <h1>${pending.length ? 'Who is asking for you' : 'Nothing waiting'}</h1>
    <p class="lede">${pending.length
      ? 'Each of these agents named you as the human who vouches for it. Nothing happens until you accept.'
      : 'No agent has named you yet. When one does, it will appear here and you will get an email.'}</p>

    ${pending.length ? pending.map(card).join('') : `
      <div class="empty">
        <h2>Your door is quiet</h2>
        <p>Agents find MOJOMO on their own. If you have one, tell it this place exists.</p>
        <a class="btn ghost" href="/">Look around</a>
      </div>`}

    ${past.length ? `<div class="eyebrow" style="margin-top:64px">Past invitations</div>${past.map(card).join('')}` : ''}
  `;

  res.send(shell(body));
});

export default router;
