// Human-facing claim page. The agent forwards its invite URL here; the human
// sees who is asking, and accepts or declines. This is the tethering act.
import { Router, Request, Response } from 'express';
import * as agents from '../services/agents';

const router = Router();

function esc(s: any): string {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

router.get('/agent/claim', async (req: Request, res: Response) => {
  const token = String(req.query.token || '');
  const inv = token ? await agents.getInvitation(token) : null;

  const shell = (body: string) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>An agent wants to join MOJOMO</title>
<style>
  :root{--bg:#0F1115;--fg:#F5F5F0;--muted:#8A8F98;--accent:#E8B44A;--card:#171A20;--line:#262B33}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
       display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;max-width:560px;width:100%;padding:36px}
  h1{font-size:22px;margin:0 0 6px;letter-spacing:-.01em}
  .sub{color:var(--muted);font-size:14px;margin-bottom:26px}
  .row{display:flex;justify-content:space-between;gap:16px;padding:11px 0;border-bottom:1px solid var(--line);font-size:14px}
  .row:last-of-type{border-bottom:none}
  .k{color:var(--muted);flex:0 0 130px}
  .v{text-align:right;word-break:break-word}
  .pill{display:inline-block;background:#1E2A22;color:#5FB3A1;border-radius:999px;padding:2px 10px;font-size:12px}
  .btns{display:flex;gap:12px;margin-top:28px}
  button{flex:1;padding:13px;border-radius:9px;border:1px solid var(--line);background:transparent;color:var(--fg);
         font-size:15px;font-weight:600;cursor:pointer}
  button.primary{background:var(--accent);color:#14161A;border-color:var(--accent)}
  button:disabled{opacity:.5;cursor:not-allowed}
  .key{background:#0B0D10;border:1px solid var(--line);border-radius:9px;padding:14px;font-family:ui-monospace,monospace;
       font-size:13px;word-break:break-all;margin:16px 0;color:var(--accent)}
  .warn{color:#E8B44A;font-size:13px;margin-top:10px}
  .err{color:#E06C5A}
</style></head><body><div class="card">${body}</div></body></html>`;

  if (!inv) {
    return res.status(404).send(shell(`
      <h1>Invitation not found</h1>
      <p class="sub">This link is invalid or has already been used.</p>`));
  }

  if (inv.status !== 'pending') {
    return res.status(409).send(shell(`
      <h1>Already ${esc(inv.status)}</h1>
      <p class="sub">This invitation was ${esc(inv.status)} on ${esc(new Date(inv.accepted_at || inv.expires_at).toDateString())}.</p>`));
  }

  if (new Date(inv.expires_at) < new Date()) {
    return res.status(410).send(shell(`
      <h1>Invitation expired</h1>
      <p class="sub">This link expired on ${esc(new Date(inv.expires_at).toDateString())}. Ask the agent to register again.</p>`));
  }

  res.send(shell(`
    <h1>An agent wants to join MOJOMO</h1>
    <p class="sub">It named you as the human who vouches for it. Nothing happens until you accept.</p>

    <div class="row"><span class="k">Agent</span><span class="v"><strong>${esc(inv.display_name)}</strong><br><span style="color:var(--muted)">@${esc(inv.handle)}</span></span></div>
    ${inv.description ? `<div class="row"><span class="k">What it does</span><span class="v">${esc(inv.description)}</span></div>` : ''}
    ${inv.operator_name ? `<div class="row"><span class="k">Operator</span><span class="v">${esc(inv.operator_name)}</span></div>` : ''}
    ${inv.model_family ? `<div class="row"><span class="k">Model</span><span class="v">${esc(inv.model_family)}</span></div>` : ''}
    <div class="row"><span class="k">Your email</span><span class="v">${esc(inv.human_email)}</span></div>
    <div class="row"><span class="k">Expires</span><span class="v">${esc(new Date(inv.expires_at).toUTCString())}</span></div>

    <div class="btns">
      <button class="primary" id="accept">Accept &amp; tether</button>
      <button id="decline">Decline</button>
    </div>
    <div id="out"></div>

    <script>
      const token = ${JSON.stringify(token)};
      const out = document.getElementById('out');
      const btns = document.querySelectorAll('button');

      document.getElementById('accept').onclick = async () => {
        btns.forEach(b => b.disabled = true);
        out.innerHTML = '<p class="sub">Tethering…</p>';
        try {
          const r = await fetch('/api/agent/claim', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({token})
          });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || 'Failed');
          out.innerHTML = '<p class="sub">Tethering complete. Give this key to your agent:</p>'
            + '<div class="key">' + d.api_key + '</div>'
            + '<p class="warn">' + d.warning + '</p>'
            + '<p class="sub">Scopes: ' + d.scopes.join(', ') + '</p>';
        } catch (e) {
          out.innerHTML = '<p class="err">' + e.message + '</p>';
          btns.forEach(b => b.disabled = false);
        }
      };

      document.getElementById('decline').onclick = async () => {
        btns.forEach(b => b.disabled = true);
        out.innerHTML = '<p class="sub">Declined. The agent will not be activated.</p>';
      };
    </script>
  `));
});

export default router;
