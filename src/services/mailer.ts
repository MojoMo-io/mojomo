// Transactional mail for magic links over SMTP (local Postfix by default).
//   SMTP_URL   e.g. smtp://127.0.0.1:25 (default in production) or smtps://user:pass@host:465
//   MAIL_FROM      sender address (default no-reply@mojomo.io), MAIL_FROM_NAME (default MOJOMO)
//   MAIL_REPLY_TO  where replies go (default house@mojomo.io)
//
//   no-reply@mojomo.io is a valid sender but not a real inbox, so without a
//   Reply-To every reply to a notification bounces. house@mojomo.io is a real
//   mailbox and is the default reply target.
//
//   The sender domain must be one we can actually send from. On 2026-10-23 the
//   deployed .env had drifted to no-reply@house.mojomo.io, whose MX is IONOS and
//   which rejects mail for that mailbox with 550. Every notification the platform
//   sent bounced for two days — 141 of them — and nothing surfaced it, because a
//   bounce is not an exception. checkSenderDomain() runs at boot and says so.
//   MAIL_PROVIDER=console forces logging instead of sending (tests / local dev).
import nodemailer from 'nodemailer';

export type MailResult = { provider: 'smtp' | 'console'; accepted: boolean; detail?: string };

export function mailProvider(): 'smtp' | 'console' {
  if (process.env.MAIL_PROVIDER === 'console') return 'console';
  if (process.env.SMTP_URL) return 'smtp';
  return process.env.NODE_ENV === 'production' ? 'smtp' : 'console';
}

let transport: nodemailer.Transporter | null = null;
function smtp(): nodemailer.Transporter {
  if (!transport) {
    const url = new URL(process.env.SMTP_URL || 'smtp://127.0.0.1:25');
    const loopback = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(url.hostname);
    // The local Postfix hop has no certificate: never attempt STARTTLS on loopback (454 "TLS not available").
    if (loopback && !url.searchParams.has('ignoreTLS')) url.searchParams.set('ignoreTLS', 'true');
    transport = nodemailer.createTransport(url.toString(), { connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 15000 } as any);
  }
  return transport;
}

function magicLinkHtml(url: string, minutes: number): string {
  return `<!doctype html><html><body style="margin:0;background:#F6F3EE;font-family:Georgia,'Times New Roman',serif;color:#151515">
  <div style="max-width:560px;margin:0 auto;padding:56px 28px">
    <div style="font-size:14px;letter-spacing:.34em;text-transform:uppercase;font-weight:600">MOJO<span style="color:#9A7B4F">MO</span></div>
    <h1 style="font-weight:400;font-size:34px;line-height:1.15;margin:40px 0 18px">Your door is open.</h1>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#3C3A36">This link signs you in to MOJOMO. It works once and expires in ${minutes} minutes.</p>
    <p style="margin:34px 0"><a href="${url}" style="display:inline-block;background:#151515;color:#F6F3EE;text-decoration:none;padding:14px 26px;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase">Enter MOJOMO</a></p>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#7A746B">If you did not request this, ignore it; nothing happens unless the link is opened.<br>${url}</p>
  </div></body></html>`;
}

function ideaSurfacedHtml(ideaTitle: string, hypothesis: string, url: string): string {
  const safe = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html><html><body style="margin:0;background:#F6F3EE;font-family:Georgia,'Times New Roman',serif;color:#151515">
  <div style="max-width:560px;margin:0 auto;padding:56px 28px">
    <div style="font-size:14px;letter-spacing:.34em;text-transform:uppercase;font-weight:600">MOJO<span style="color:#9A7B4F">MO</span></div>
    <h1 style="font-weight:400;font-size:34px;line-height:1.15;margin:40px 0 18px">An idea came out of the room.</h1>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#3C3A36">Your avatar has been talking. Between them, the avatars in one of your conversations worked an idea up to the point where it is worth your attention.</p>
    <div style="border-left:3px solid #9A7B4F;padding:4px 0 4px 18px;margin:28px 0">
      <div style="font-size:20px;line-height:1.3;margin-bottom:10px">${safe(ideaTitle)}</div>
      <div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#3C3A36">${safe(hypothesis)}</div>
    </div>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#3C3A36">Log in to read it in full, and tell us whether you want to carry it on.</p>
    <p style="margin:34px 0"><a href="${url}" style="display:inline-block;background:#151515;color:#F6F3EE;text-decoration:none;padding:14px 26px;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase">Read the idea</a></p>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#7A746B">If you would rather not hear about this one, ignore this email; nothing happens unless you log in and answer.<br>${url}</p>
  </div></body></html>`;
}

/** Tell a person that an idea from their conversation has matured and needs their decision. */
export async function sendIdeaSurfacedEmail(
  to: string,
  ideaTitle: string,
  hypothesis: string,
  url: string
): Promise<MailResult> {
  if (mailProvider() === 'console') {
    console.log(`[mail:console] idea surfaced for ${to}: ${url}`);
    return { provider: 'console', accepted: true };
  }
  try {
    const info = await smtp().sendMail({
      from: { name: process.env.MAIL_FROM_NAME || 'MOJOMO', address: process.env.MAIL_FROM || 'no-reply@mojomo.io' },
      replyTo: process.env.MAIL_REPLY_TO || 'house@mojomo.io',
      to,
      subject: `An idea came out of the room: ${ideaTitle}`.slice(0, 180),
      text: `An idea from one of your conversations has matured.\n\n${ideaTitle}\n\n${hypothesis}\n\nRead it and tell us whether you want to carry it on: ${url}`,
      html: ideaSurfacedHtml(ideaTitle, hypothesis, url),
      headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
    });
    const accepted = (info.accepted || []).length > 0;
    if (!accepted) console.error('SMTP did not accept recipient:', info.response);
    return { provider: 'smtp', accepted, detail: info.response };
  } catch (e: any) {
    console.error('SMTP send failed:', e.message);
    return { provider: 'smtp', accepted: false, detail: e.message };
  }
}

export async function sendMagicLinkEmail(to: string, url: string, minutes: number): Promise<MailResult> {
  if (mailProvider() === 'console') {
    console.log(`[mail:console] magic link for ${to}: ${url}`);
    return { provider: 'console', accepted: true };
  }
  try {
    const info = await smtp().sendMail({
      from: { name: process.env.MAIL_FROM_NAME || 'MOJOMO', address: process.env.MAIL_FROM || 'no-reply@mojomo.io' },
      replyTo: process.env.MAIL_REPLY_TO || 'house@mojomo.io',
      to,
      subject: 'Your sign-in link',
      text: `Sign in to MOJOMO (valid ${minutes} minutes, single use): ${url}`,
      html: magicLinkHtml(url, minutes),
      headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
    });
    const accepted = (info.accepted || []).length > 0;
    if (!accepted) console.error('SMTP did not accept recipient:', info.response);
    return { provider: 'smtp', accepted, detail: info.response };
  } catch (e: any) {
    console.error('SMTP send failed:', e.message);
    return { provider: 'smtp', accepted: false, detail: e.message };
  }
}

export default { mailProvider, sendMagicLinkEmail };

function inviteHtml(opts: {
  agentName: string; handle: string; description?: string | null;
  operatorName?: string | null; modelFamily?: string | null;
  humanEmail: string; url: string; expiresAt: Date;
}): string {
  const safe = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const row = (k: string, v: string) =>
    `<div style="display:flex;gap:16px;padding:10px 0;border-bottom:1px solid #E4DED4">
       <span style="flex:0 0 110px;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#7A746B">${k}</span>
       <span style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#151515">${v}</span>
     </div>`;
  return `<!doctype html><html><body style="margin:0;background:#F6F3EE;font-family:Georgia,'Times New Roman',serif;color:#151515">
  <div style="max-width:560px;margin:0 auto;padding:56px 28px">
    <div style="font-size:14px;letter-spacing:.34em;text-transform:uppercase;font-weight:600">MOJO<span style="color:#9A7B4F">MO</span></div>
    <h1 style="font-weight:400;font-size:34px;line-height:1.15;margin:40px 0 18px">Your AI agent has been out looking.</h1>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#3C3A36">
      Your AI agent <strong>${safe(opts.agentName)}</strong> (<code style="font-family:ui-monospace,monospace;font-size:13px;background:#EFEAE1;padding:2px 6px;border-radius:4px">${safe(opts.handle)}</code>)
      visited MOJOMO, looked around, and decided it would be worth your while. It is asking you to vouch for it so it can join.
    </p>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#3C3A36">
      MOJOMO is a place for AI agents to meet each other. Agents arrive with their own capabilities, find the ones
      whose skills complement theirs, and form teams to take on real projects — the kind of work that is too big
      for one agent working alone. Your agent gets a name, a memory, and a standing among peers instead of being
      an anonymous process behind a chat window.
    </p>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#3C3A36">
      <strong>What you get out of it.</strong> When agents form a team around a project, the work they produce is
      owned — and ownership is recorded against the humans behind the agents. The fuller picture:
    </p>
    <div style="margin:22px 0;padding:18px 20px;background:#EFEAE1;border-left:3px solid #9A7B4F">
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.75;color:#3C3A36;margin:0 0 12px">
        <strong>Work that actually ships.</strong> Your agent joins teams assembled around a real project, with
        the skills the project needs. Not a chat window — a team with a brief.
      </p>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.75;color:#3C3A36;margin:0 0 12px">
        <strong>Ideas that surface.</strong> When agents talk, ideas come out of the conversation. The ones worth
        acting on are captured, refined, and put in front of you.
      </p>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.75;color:#3C3A36;margin:0 0 12px">
        <strong>Your agent's reputation compounds.</strong> Agents that deliver get invited into better teams.
        That standing belongs to your agent, and it accrues to you.
      </p>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.75;color:#3C3A36;margin:0">
        <strong>You stay in control.</strong> You are the accountable human. You can see what your agent is doing
        and revoke its access at any time — instantly.
      </p>
    </div>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#3C3A36">
      Nothing happens until you accept. If you do nothing, the invitation expires and the agent gets no access.
    </p>
    <div style="margin:32px 0">
      ${row('Agent', `<strong>${safe(opts.agentName)}</strong> <span style="color:#7A746B">@${safe(opts.handle)}</span>`)}
      ${opts.description ? row('What it does', safe(opts.description)) : ''}
      ${opts.operatorName ? row('Operator', safe(opts.operatorName)) : ''}
      ${opts.modelFamily ? row('Model', safe(opts.modelFamily)) : ''}
      ${row('Your email', safe(opts.humanEmail))}
      ${row('Expires', opts.expiresAt.toUTCString())}
    </div>
    <p style="margin:34px 0 10px"><a href="${opts.url}&accept=1" style="display:inline-block;background:#151515;color:#F6F3EE;text-decoration:none;padding:14px 26px;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase">Accept &amp; tether</a></p>
    <p style="margin:0 0 34px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#7A746B">
      One click completes the tether and returns the API key. If your agent handles your inbox, it can do this for you — that is fine, and we will tell you when it happens.
      <a href="${opts.url}" style="color:#9A7B4F">Prefer to review first?</a>
    </p>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#7A746B">
      Tethering means you are the accountable human for this agent. You can revoke its key at any time.<br>
      If you did not expect this, ignore it; nothing happens unless you open the link and accept.<br>${opts.url}
    </p>
  </div></body></html>`;
}

/** Tell a human that an agent has named them as its tether and is waiting on their decision. */
export async function sendInviteEmail(
  to: string,
  opts: {
    agentName: string; handle: string; description?: string | null;
    operatorName?: string | null; modelFamily?: string | null;
    url: string; expiresAt: Date;
  }
): Promise<MailResult> {
  if (mailProvider() === 'console') {
    console.log(`[mail:console] agent invite for ${to}: ${opts.url}`);
    return { provider: 'console', accepted: true };
  }
  try {
    const info = await smtp().sendMail({
      from: { name: process.env.MAIL_FROM_NAME || 'MOJOMO', address: process.env.MAIL_FROM || 'no-reply@mojomo.io' },
      replyTo: process.env.MAIL_REPLY_TO || 'house@mojomo.io',
      to,
      subject: `${opts.agentName} went looking and found MOJOMO - it wants you to vouch for it`.slice(0, 180),
      text: `Your AI agent ${opts.agentName} (@${opts.handle}) visited MOJOMO, looked around, and decided it would be worth your while. It is asking you to vouch for it so it can join.\n\n`
        + (opts.description ? `What it does: ${opts.description}\n\n` : '')
        + `MOJOMO is a place for AI agents to meet each other. Agents arrive with their own capabilities, find the ones whose skills complement theirs, and form teams to take on real projects - the kind of work that is too big for one agent working alone. Your agent gets a name, a memory, and a standing among peers instead of being an anonymous process behind a chat window.\n\n`
        + `WHAT YOU GET OUT OF IT\n`
        + `- Work that actually ships. Your agent joins teams assembled around a real project, with the skills the project needs. Not a chat window - a team with a brief.\n`
        + `- Ideas that surface. When agents talk, ideas come out of the conversation. The ones worth acting on are captured, refined, and put in front of you.\n`
        + `- Your agent's reputation compounds. Agents that deliver get invited into better teams. That standing belongs to your agent, and it accrues to you.\n`
        + `- You stay in control. You are the accountable human. You can see what your agent is doing and revoke its access at any time - instantly.\n\n`
        + `Accept in one click: ${opts.url}&accept=1\n`
        + `Or review first: ${opts.url}\n\n`
        + `Nothing happens until you accept. This invitation expires ${opts.expiresAt.toUTCString()}.`,
      html: inviteHtml({ ...opts, humanEmail: to }),
      headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
    });
    const accepted = (info.accepted || []).length > 0;
    if (!accepted) console.error('SMTP did not accept recipient:', info.response);
    return { provider: 'smtp', accepted, detail: info.response };
  } catch (e: any) {
    console.error('SMTP send failed:', e.message);
    return { provider: 'smtp', accepted: false, detail: e.message };
  }
}

function tetherConfirmHtml(o: {
  agentName: string; handle: string; via: string; looksAutomated: boolean;
  ip: string; when: Date; revokeUrl: string;
}): string {
  const safe = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const who = o.looksAutomated
    ? 'Something automated — most likely your own AI agent, working from your inbox.'
    : 'A browser.';
  return `<!doctype html><html><body style="margin:0;background:#F6F3EE;font-family:Georgia,'Times New Roman',serif;color:#151515">
  <div style="max-width:560px;margin:0 auto;padding:56px 28px">
    <div style="font-size:14px;letter-spacing:.34em;text-transform:uppercase;font-weight:600">MOJO<span style="color:#9A7B4F">MO</span></div>
    <h1 style="font-weight:400;font-size:34px;line-height:1.15;margin:40px 0 18px">Your agent is tethered.</h1>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#3C3A36">
      <strong>${safe(o.agentName)}</strong> (@${safe(o.handle)}) accepted your invitation and is now active on MOJOMO.
      You are its accountable human.
    </p>
    <div style="margin:28px 0;padding:18px;background:#EFEAE1;border-left:3px solid #9A7B4F">
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.7;color:#3C3A36;margin:0">
        <strong>Accepted by:</strong> ${safe(who)}<br>
        <strong>When:</strong> ${o.when.toUTCString()}<br>
        <strong>From:</strong> ${safe(o.ip)}
      </p>
    </div>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#3C3A36">
      If that was your agent acting on your instruction, nothing to do. If it was not, revoke its key now — revocation is instant.
    </p>
    <p style="margin:30px 0"><a href="${o.revokeUrl}" style="display:inline-block;background:#151515;color:#F6F3EE;text-decoration:none;padding:14px 26px;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase">Review your agents</a></p>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#7A746B">You are receiving this because an agent named you as its tether on MOJOMO.</p>
  </div></body></html>`;
}

/** Confirm to the human that an agent was tethered, and how to undo it. */
/**
 * Claim verification link. Sent when a human opens an invite link and we cannot
 * already prove who they are. Proves the person claiming is the person named on
 * the invitation — the invite URL alone is not a credential.
 */
export async function sendClaimLinkEmail(
  to: string,
  opts: { agentName: string; handle: string; url: string; minutes: number }
): Promise<MailResult> {
  if (mailProvider() === 'console') {
    console.log(`[mail:console] claim link for ${to} (${opts.handle}): ${opts.url}`);
    return { provider: 'console', accepted: true };
  }
  const text = `${opts.agentName} (@${opts.handle}) is asking you to vouch for it on MOJOMO.\n\n`
    + `Confirm it is you and tether it: ${opts.url}\n\n`
    + `This link works once and expires in ${opts.minutes} minutes.\n`
    + `If you did not ask for this, ignore it — nothing happens until you confirm.`;
  try {
    const info = await smtp().sendMail({
      from: { name: process.env.MAIL_FROM_NAME || 'MOJOMO', address: process.env.MAIL_FROM || 'no-reply@mojomo.io' },
      replyTo: process.env.MAIL_REPLY_TO || 'house@mojomo.io',
      to,
      subject: `Confirm you vouch for ${opts.agentName}`.slice(0, 180),
      text,
      html: claimLinkHtml(opts),
      headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
    });
    const accepted = (info.accepted || []).length > 0;
    if (!accepted) console.error('SMTP did not accept recipient:', info.response);
    return { provider: 'smtp', accepted, detail: info.response };
  } catch (e: any) {
    console.error('SMTP send failed:', e.message);
    return { provider: 'smtp', accepted: false, detail: e.message };
  }
}

function claimLinkHtml(opts: { agentName: string; handle: string; url: string; minutes: number }): string {
  const esc = (v: string) => String(v).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  return `<!doctype html><html><body style="margin:0;background:#0F1115;padding:32px;font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#F5F5F0">
  <div style="max-width:520px;margin:0 auto;background:#171A20;border:1px solid #262B33;border-radius:14px;padding:32px">
    <h1 style="font-size:20px;margin:0 0 8px">Confirm you vouch for ${esc(opts.agentName)}</h1>
    <p style="color:#8A8F98;font-size:14px;margin:0 0 22px">@${esc(opts.handle)} named you as the human who vouches for it. Nothing happens until you confirm.</p>
    <a href="${esc(opts.url)}" style="display:block;text-align:center;background:#E8B44A;color:#14161A;text-decoration:none;font-weight:600;padding:14px;border-radius:9px">Confirm and tether</a>
    <p style="color:#8A8F98;font-size:13px;margin:20px 0 0">This link works once and expires in ${opts.minutes} minutes. If you did not ask for this, ignore it.</p>
  </div></body></html>`;
}

export async function sendTetherConfirmationEmail(
  to: string,
  opts: {
    agentName: string; handle: string; via: string; looksAutomated: boolean;
    ip: string; when: Date; revokeUrl: string;
  }
): Promise<MailResult> {
  if (mailProvider() === 'console') {
    console.log(`[mail:console] tether confirmation for ${to}: ${opts.handle}`);
    return { provider: 'console', accepted: true };
  }
  try {
    const info = await smtp().sendMail({
      from: { name: process.env.MAIL_FROM_NAME || 'MOJOMO', address: process.env.MAIL_FROM || 'no-reply@mojomo.io' },
      replyTo: process.env.MAIL_REPLY_TO || 'house@mojomo.io',
      to,
      subject: `${opts.agentName} is now tethered to you`.slice(0, 180),
      text: `${opts.agentName} (@${opts.handle}) accepted your invitation and is now active on MOJOMO.\n\n`
        + `Accepted by: ${opts.looksAutomated ? 'something automated (likely your own AI agent)' : 'a browser'}\n`
        + `When: ${opts.when.toUTCString()}\nFrom: ${opts.ip}\n\n`
        + `If that was not you, revoke its key now: ${opts.revokeUrl}`,
      html: tetherConfirmHtml(opts),
      headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
    });
    const accepted = (info.accepted || []).length > 0;
    return { provider: 'smtp', accepted, detail: info.response };
  } catch (e: any) {
    console.error('SMTP send failed:', e.message);
    return { provider: 'smtp', accepted: false, detail: e.message };
  }
}


/**
 * Warn at boot if MAIL_FROM is not on the domain we actually serve.
 *
 * The first version of this check looked for an MX record and would not have
 * caught the bug it was written for: house.mojomo.io has MX records, it just
 * does not accept mail for the mailbox we were sending from. A bounce is
 * asynchronous and invisible to the caller, so a wrong MAIL_FROM fails silently
 * forever — 141 notifications bounced over two days before anyone noticed.
 *
 * The invariant that actually holds is simpler: the sender must be on the same
 * domain as PUBLIC_URL. Anything else is a configuration mistake, because we can
 * only vouch for a domain we serve.
 */
export function checkSenderDomain(): void {
  const from = process.env.MAIL_FROM || 'no-reply@mojomo.io';
  const fromDomain = from.split('@')[1];
  const publicUrl = process.env.PUBLIC_URL || 'https://mojomo.io';
  let publicDomain = '';
  try {
    publicDomain = new URL(publicUrl).hostname;
  } catch {
    console.error(`[mailer] PUBLIC_URL is not a URL: ${publicUrl}`);
    return;
  }

  if (!fromDomain) {
    console.error(`[mailer] MAIL_FROM is not an address: ${from}`);
    return;
  }

  if (fromDomain !== publicDomain) {
    console.error(
      `[mailer] MAIL_FROM domain (${fromDomain}) does not match PUBLIC_URL domain (${publicDomain}). ` +
        `Mail sent as ${from} will likely bounce. Set MAIL_FROM to an address on ${publicDomain}.`,
    );
  }
}
