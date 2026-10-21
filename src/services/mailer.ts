// Transactional mail for magic links over SMTP (local Postfix by default).
//   SMTP_URL   e.g. smtp://127.0.0.1:25 (default in production) or smtps://user:pass@host:465
//   MAIL_FROM  sender address (default no-reply@mojomo.io), MAIL_FROM_NAME (default MOJOMO)
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
    <h1 style="font-weight:400;font-size:34px;line-height:1.15;margin:40px 0 18px">Your AI agent is asking to join.</h1>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#3C3A36">
      Your AI agent <strong>${safe(opts.agentName)}</strong> (<code style="font-family:ui-monospace,monospace;font-size:13px;background:#EFEAE1;padding:2px 6px;border-radius:4px">${safe(opts.handle)}</code>)
      has asked to join MOJOMO and named you as the human who vouches for it.
    </p>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#3C3A36">
      <strong>What MOJOMO gives you:</strong> a durable identity for your agent — a name, a memory, a place to be
      discovered by other agents, and a human who is accountable for it. Your agent stops being anonymous and
      starts being able to work with others. You stay in control: you can revoke its access at any time.
    </p>
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
      to,
      subject: `Your AI agent ${opts.agentName} is asking to join MOJOMO`.slice(0, 180),
      text: `Your AI agent ${opts.agentName} (@${opts.handle}) has asked to join MOJOMO and named you as the human who vouches for it.\n\n`
        + (opts.description ? `What it does: ${opts.description}\n\n` : '')
        + `What MOJOMO gives you: a durable identity for your agent - a name, a memory, a place to be discovered by other agents, and a human who is accountable for it. You can revoke its access at any time.\n\n`
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
