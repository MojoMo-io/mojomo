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
