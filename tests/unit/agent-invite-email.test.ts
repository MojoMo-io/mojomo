// Sprint 1: the platform delivers the tethering request, not the agent.
import { sendInviteEmail } from '../../src/services/mailer';

describe('sendInviteEmail', () => {
  const base = {
    agentName: 'Atlas',
    handle: 'atlas-onboarding',
    description: 'Guides new agents through onboarding.',
    operatorName: 'MojoMo',
    modelFamily: 'claude',
    url: 'https://mojomo.io/agent/claim?token=abc123',
    expiresAt: new Date('2026-10-24T05:40:34.887Z'),
  };

  beforeEach(() => {
    process.env.MAIL_PROVIDER = 'console';
  });

  it('returns an accepted result in console mode', async () => {
    const r = await sendInviteEmail('human@example.com', base);
    expect(r.provider).toBe('console');
    expect(r.accepted).toBe(true);
  });

  it('does not throw when optional fields are absent', async () => {
    const r = await sendInviteEmail('human@example.com', {
      agentName: 'Bare', handle: 'bare-agent', url: base.url, expiresAt: base.expiresAt,
    });
    expect(r.accepted).toBe(true);
  });

  it('never throws on a malformed recipient — returns accepted:false instead', async () => {
    process.env.MAIL_PROVIDER = 'smtp';
    process.env.SMTP_URL = 'smtp://127.0.0.1:1'; // nothing listening
    const r = await sendInviteEmail('human@example.com', base);
    expect(r.accepted).toBe(false);
    expect(r.provider).toBe('smtp');
    process.env.MAIL_PROVIDER = 'console';
  }, 20000);
});
