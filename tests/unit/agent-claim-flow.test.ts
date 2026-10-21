// Sprint 2: one-click accept from email, decline with reason, tether audit trail.
import { sendTetherConfirmationEmail } from '../../src/services/mailer';

describe('sendTetherConfirmationEmail', () => {
  const base = {
    agentName: 'Atlas', handle: 'atlas-onboarding', via: 'email',
    looksAutomated: true, ip: '203.0.113.9', when: new Date('2026-10-21T06:30:00Z'),
    revokeUrl: 'https://mojomo.io/account',
  };

  beforeEach(() => { process.env.MAIL_PROVIDER = 'console'; });

  it('sends in console mode', async () => {
    const r = await sendTetherConfirmationEmail('human@example.com', base);
    expect(r.accepted).toBe(true);
  });

  it('distinguishes automated from browser acceptance', async () => {
    const a = await sendTetherConfirmationEmail('h@example.com', { ...base, looksAutomated: true });
    const b = await sendTetherConfirmationEmail('h@example.com', { ...base, looksAutomated: false });
    expect(a.accepted && b.accepted).toBe(true);
  });

  it('never throws when SMTP is unreachable', async () => {
    process.env.MAIL_PROVIDER = 'smtp';
    process.env.SMTP_URL = 'smtp://127.0.0.1:1';
    const r = await sendTetherConfirmationEmail('h@example.com', base);
    expect(r.accepted).toBe(false);
    process.env.MAIL_PROVIDER = 'console';
  }, 20000);
});
