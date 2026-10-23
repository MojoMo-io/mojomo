// Human-facing inbox: what your agents are asking you to decide.
//
// Every request carries provenance — the conversation or task that triggered
// it — because an answer given blind is an answer you will stop trusting.
import { Router, Request, Response } from 'express';
import * as auth from '../services/auth';
import * as decisions from '../services/decisionRequests';
import { parseCookies } from '../middleware/auth';

const router = Router();

function esc(s: any): string {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

const shell = (body: string) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Decisions — MOJOMO</title>
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
  .req{border:1px solid var(--line);background:var(--bone-2);padding:28px 30px;margin-bottom:14px}
  .req.high{border-left:3px solid var(--rust)}
  .req-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:14px}
  .from{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ochre);margin-bottom:6px}
  .title{font-family:var(--serif);font-size:23px;line-height:1.2}
  .body{font-size:14px;color:var(--ink-2);margin:12px 0 0;white-space:pre-wrap}
  .prov{font-size:11.5px;color:var(--muted);margin-top:14px;letter-spacing:.04em;padding-top:12px;border-top:1px solid var(--line)}
  .opts{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}
  .opt{border:1px solid var(--line-2);background:transparent;padding:11px 20px;font-family:var(--sans);font-size:12px;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;color:var(--ink);transition:all .15s}
  .opt:hover{background:var(--ink);color:var(--bone);border-color:var(--ink)}
  .opt:disabled{opacity:.4;cursor:default}
  .opt .d{display:block;font-size:10.5px;letter-spacing:.02em;text-transform:none;color:var(--muted);margin-top:3px}
  .free{display:flex;gap:10px;margin-top:18px}
  .free textarea{flex:1;min-height:80px;padding:12px 14px;border:1px solid var(--line-2);background:var(--bone);font-family:var(--sans);font-size:14px;resize:vertical;color:var(--ink)}
  .free button{border:1px solid var(--ink);background:var(--ink);color:var(--bone);padding:0 22px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;cursor:pointer}
  .pill{display:inline-block;font-size:10px;letter-spacing:.16em;text-transform:uppercase;padding:4px 10px;border:1px solid var(--line-2);color:var(--muted)}
  .pill.high{border-color:var(--rust);color:var(--rust)}
  .answered{opacity:.6}
  .ans{font-size:13px;color:var(--teal);margin-top:12px;letter-spacing:.04em}
  .empty{border:1px solid var(--line);padding:56px 40px;text-align:center}
  .empty h2{font-family:var(--serif);font-weight:300;font-size:30px;margin:0 0 12px}
  .empty p{color:var(--ink-2);margin:0 0 24px}
  .btn{display:inline-block;border:1px solid var(--line-2);padding:13px 26px;font-size:11px;letter-spacing:.16em;text-transform:uppercase}
  .btn:hover{background:var(--ink);color:var(--bone);border-color:var(--ink)}
  .err{color:var(--rust);font-size:13px;margin-top:10px}
  @media(max-width:640px){
    .wrap{padding:0 20px}
    .req{padding:22px 20px}
    .req-head{flex-direction:column;gap:10px}
    .free{flex-direction:column}
    .free button{padding:14px}
  }
</style></head><body>
<div class="bar"><div class="wrap">
  <a class="mark" href="/">Mojo<span>mo</span></a>
  <div class="nav"><a href="/invitations">Invitations</a><a href="/decisions">Decisions</a><a href="/">Home</a></div>
</div></div>
<main><div class="wrap">${body}</div></main>
</body></html>`;

function rel(d: any): string {
  if (!d) return '';
  const ms = new Date(d).getTime() - Date.now();
  const abs = Math.abs(ms);
  const m = Math.floor(abs / 60000);
  const suffix = ms < 0 ? ' ago' : '';
  const prefix = ms > 0 ? 'in ' : '';
  if (m < 1) return ms < 0 ? 'just now' : 'in under a minute';
  if (m < 60) return `${prefix}${m}m${suffix}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${prefix}${h}h${suffix}`;
  return `${prefix}${Math.floor(h / 24)}d${suffix}`;
}

function provenance(r: any): string {
  const bits: string[] = [];
  if (r.task_id) bits.push(`task ${String(r.task_id).slice(0, 8)}`);
  if (r.conversation_id) bits.push(`conversation ${String(r.conversation_id).slice(0, 8)}`);
  if (!bits.length) bits.push('asked directly');
  return bits.join(' · ');
}

function card(r: any): string {
  const opts = Array.isArray(r.options) ? r.options : [];
  const isPending = r.status === 'pending';
  const cls = [r.status === 'answered' ? 'answered' : '', r.urgency === 'high' ? 'high' : ''].filter(Boolean).join(' ');
  return `<div class="req ${cls}" data-req="${esc(r.id)}">
    <div class="req-head">
      <div>
        <div class="from">${esc(r.display_name)} <span style="color:var(--muted)">@${esc(r.handle)}</span></div>
        <div class="title">${esc(r.title)}</div>
      </div>
      <div style="text-align:right;white-space:nowrap">
        ${r.urgency === 'high' ? '<span class="pill high">urgent</span> ' : ''}
        <span class="pill">${esc(r.status)}</span>
      </div>
    </div>
    ${r.body ? `<div class="body">${esc(r.body)}</div>` : ''}
    <div class="prov">${provenance(r)} · asked ${rel(r.created_at)}${isPending ? ' · expires ' + rel(r.expires_at) : ''}</div>
    ${isPending ? (r.kind === 'freeform'
      ? `<div class="free">
           <textarea placeholder="Your answer…" data-input="${esc(r.id)}"></textarea>
           <button data-send="${esc(r.id)}">Send</button>
         </div>`
      : `<div class="opts">${opts.map((o: any) =>
          `<button class="opt" data-answer="${esc(r.id)}" data-value="${esc(o.id)}">${esc(o.label)}${o.detail ? `<span class="d">${esc(o.detail)}</span>` : ''}</button>`
        ).join('')}</div>`)
      : (r.answer ? `<div class="ans">You answered: ${esc(r.answer)}${r.answer_note ? ' — ' + esc(r.answer_note) : ''}</div>` : '')}
    <div class="err" data-err="${esc(r.id)}"></div>
  </div>`;
}

router.get('/decisions', async (req: Request, res: Response) => {
  const session = await auth.getSession(parseCookies(req.headers.cookie)[auth.SESSION_COOKIE]).catch(() => null);
  if (!session) {
    return res.send(shell(`
      <div class="eyebrow">Decisions</div>
      <h1>What your agents are asking</h1>
      <p class="lede">Sign in to see the decisions waiting on you.</p>
      <a class="btn" href="/login">Sign in</a>`));
  }

  const rows = await decisions.listForUser(session.userId, { includeAnswered: false });
  const pending = rows.filter((r: any) => r.status === 'pending');
  const answered = await decisions.listForUser(session.userId, { includeAnswered: true });
  const recent = answered.filter((r: any) => r.status !== 'pending').slice(0, 20);

  const body = `
    <div class="eyebrow">Signed in as ${esc(session.email)}</div>
    <h1>${pending.length ? pending.length + (pending.length === 1 ? ' decision' : ' decisions') + ' waiting' : 'Nothing waiting'}</h1>
    <p class="lede">${pending.length
      ? 'Your agents have stopped and asked. Each one is blocked until you answer.'
      : 'Your agents have not asked you anything. When one does, it will appear here.'}</p>

    ${pending.length ? pending.map(card).join('') : `
      <div class="empty">
        <h2>Your agents are getting on with it</h2>
        <p>Nothing needs your judgement right now.</p>
        <a class="btn" href="/invitations">See who you vouch for</a>
      </div>`}

    ${recent.length ? `<div class="eyebrow" style="margin-top:64px">Recently answered</div>${recent.map(card).join('')}` : ''}

    <script>
      const post = async (url, body) => {
        const r = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Something went wrong.');
        return d;
      };
      const fail = (id, msg) => {
        const el = document.querySelector('[data-err="' + id + '"]');
        if (el) el.textContent = msg;
      };
      document.querySelectorAll('[data-answer]').forEach(b => {
        b.onclick = async () => {
          const id = b.getAttribute('data-answer');
          const val = b.getAttribute('data-value');
          const card = b.closest('.req');
          card.querySelectorAll('button').forEach(x => x.disabled = true);
          try {
            await post('/api/decisions/' + id + '/answer', {answer: val});
            card.classList.add('answered');
            card.querySelector('.opts').innerHTML = '<div class="ans">Answered: ' + val + '</div>';
          } catch (e) { fail(id, e.message); card.querySelectorAll('button').forEach(x => x.disabled = false); }
        };
      });
      document.querySelectorAll('[data-send]').forEach(b => {
        b.onclick = async () => {
          const id = b.getAttribute('data-send');
          const ta = document.querySelector('[data-input="' + id + '"]');
          const val = (ta.value || '').trim();
          if (!val) return fail(id, 'Write something first.');
          b.disabled = true;
          try {
            await post('/api/decisions/' + id + '/answer', {answer: val});
            const card = b.closest('.req');
            card.classList.add('answered');
            card.querySelector('.free').innerHTML = '<div class="ans">Answered.</div>';
          } catch (e) { fail(id, e.message); b.disabled = false; }
        };
      });
    </script>`;

  res.send(shell(body));
});

export default router;
