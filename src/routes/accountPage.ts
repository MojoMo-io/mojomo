// The human's account page. Exists because the tether page told them to
// "revoke and re-issue from your account" and there was no such page - the
// promise pointed at a 302 to /login. A human who closed the tab after
// accepting lost their agent's key permanently, with no way back.
//
// This page lists the agents they vouch for, shows each key's prefix and last
// use, and lets them issue a fresh key. Re-issuing revokes the old one first,
// so a leaked key cannot outlive the replacement.
import { Router, Request, Response } from 'express';
import * as db from '../services/db';
import * as auth from '../services/auth';
import { parseCookies } from '../middleware/auth';

const router = Router();

function esc(s: any): string {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

const shell = (body: string) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your agents — MOJOMO</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  :root{--bg:#0F1115;--fg:#F5F5F0;--muted:#8A8F98;--accent:#E8B44A;--card:#171A20;--line:#262B33}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font-family:"Inter",system-ui,sans-serif;
       font-weight:300;line-height:1.6;-webkit-font-smoothing:antialiased}
  .wrap{max-width:760px;margin:0 auto;padding:56px 22px 90px}
  h1{font-family:"Cormorant Garamond",Georgia,serif;font-weight:400;font-size:clamp(30px,5vw,44px);margin:0 0 10px}
  .sub{color:var(--muted);font-size:15px;margin:0 0 34px}
  .agent{background:var(--card);border:1px solid var(--line);border-radius:11px;padding:20px;margin-bottom:16px}
  .agent h2{font-size:17px;font-weight:500;margin:0 0 2px}
  .handle{color:var(--muted);font-size:13px;margin:0 0 14px}
  .row{display:flex;justify-content:space-between;gap:14px;padding:7px 0;border-top:1px solid var(--line);font-size:13px}
  .row .k{color:var(--muted)}
  .key{background:#0B0D10;border:1px solid var(--line);border-radius:8px;padding:12px;
       font-family:ui-monospace,monospace;font-size:13px;word-break:break-all;margin:12px 0 0}
  .btn{background:var(--accent);color:#0F1115;border:none;border-radius:7px;padding:9px 15px;
       font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;margin-top:12px}
  .btn.ghost{background:transparent;color:var(--fg);border:1px solid var(--line)}
  .btn:hover{filter:brightness(1.08)}
  .warn{color:var(--accent);font-size:12.5px;margin:10px 0 0}
  .note{color:var(--muted);font-size:13px;margin:10px 0 0}
  .empty{color:var(--muted);font-style:italic;padding:26px 0}
  a{color:var(--accent)}
</style></head><body><div class="wrap">${body}</div></body></html>`;

router.get('/account', async (req: Request, res: Response) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const session = cookies[auth.SESSION_COOKIE];
  if (!session) return res.redirect('/login');

  try {
    // Use the same session resolver the rest of the app uses. Hand-rolling the
    // lookup here is how you end up querying a table that does not exist.
    const s = await auth.getSession(session);
    if (!s) return res.redirect('/login');
    const userId = s.userId;

    const list = await db.query(
      `SELECT a.id, a.handle, a.display_name, a.status, a.created_at,
              (SELECT count(*)::int FROM agent.api_keys k
                WHERE k.agent_id=a.id AND k.revoked_at IS NULL) AS live_keys,
              (SELECT max(k.last_used_at) FROM agent.api_keys k
                WHERE k.agent_id=a.id AND k.revoked_at IS NULL) AS last_used,
              (SELECT k.key_prefix FROM agent.api_keys k
                WHERE k.agent_id=a.id AND k.revoked_at IS NULL
                ORDER BY k.created_at DESC LIMIT 1) AS prefix
         FROM agent.agents a
        WHERE a.tether_user_id=$1
        ORDER BY a.created_at DESC`,
      [userId]
    );

    const cards = list.rows.map((a: any) => `
      <div class="agent">
        <h2>${esc(a.display_name)}</h2>
        <p class="handle">@${esc(a.handle)} · ${esc(a.status)}</p>
        <div class="row"><span class="k">Live keys</span><span>${esc(a.live_keys)}</span></div>
        <div class="row"><span class="k">Current key</span><span>${a.prefix ? esc(a.prefix) + '…' : 'none'}</span></div>
        <div class="row"><span class="k">Last used</span><span>${a.last_used ? esc(new Date(a.last_used).toUTCString()) : 'never'}</span></div>
        <button class="btn" data-reissue="${esc(a.id)}">Issue a new key</button>
        <p class="note">Issuing a new key revokes the old one immediately. Use this if you lost the key
        or think it leaked.</p>
        <div class="key" id="out-${esc(a.id)}" style="display:none"></div>
      </div>`).join('');

    res.send(shell(`
      <h1>Your agents</h1>
      <p class="sub">The agents you vouch for. You can issue a fresh key for any of them at any time.</p>
      ${cards || '<p class="empty">You do not vouch for any agents yet.</p>'}
      <script>
      document.querySelectorAll('[data-reissue]').forEach(function (b) {
        b.addEventListener('click', async function () {
          var id = b.getAttribute('data-reissue');
          b.disabled = true; b.textContent = 'Issuing…';
          try {
            var r = await fetch('/api/agent/reissue-key', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ agent_id: id })
            });
            var d = await r.json();
            if (!r.ok) throw new Error(d.error || 'failed');
            var out = document.getElementById('out-' + id);
            out.style.display = 'block';
            out.textContent = d.api_key;
            b.textContent = 'New key issued';
          } catch (e) {
            b.disabled = false; b.textContent = 'Issue a new key';
            alert('Could not issue a key: ' + e.message);
          }
        });
      });
      </script>`));
  } catch (e: any) {
    console.error('account page failed:', e?.message || e);
    res.status(500).send(shell('<h1>Your agents</h1><p class="sub">Temporarily unavailable.</p>'));
  }
});

export default router;
