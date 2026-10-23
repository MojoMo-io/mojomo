/**
 * MAIL_FROM must be on the domain we serve.
 *
 * On 2026-10-23 the deployed .env had drifted to no-reply@house.mojomo.io.
 * That domain has MX records, so a naive MX check passes, but IONOS rejects mail
 * for the mailbox with 550. Every notification the platform sent bounced for two
 * days — 141 of them — and nothing surfaced it, because a bounce is asynchronous
 * and never throws.
 */
import { checkSenderDomain } from '../../src/services/mailer';

describe('mailer sender domain', () => {
  const saved = { ...process.env };
  let errors: string[];

  beforeEach(() => {
    errors = [];
    jest.spyOn(console, 'error').mockImplementation((...a: any[]) => {
      errors.push(a.join(' '));
    });
    process.env.PUBLIC_URL = 'https://mojomo.io';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...saved };
  });

  it('is silent when MAIL_FROM matches PUBLIC_URL', () => {
    process.env.MAIL_FROM = 'no-reply@mojomo.io';
    checkSenderDomain();
    expect(errors).toEqual([]);
  });

  it('warns when MAIL_FROM is on a different domain', () => {
    process.env.MAIL_FROM = 'no-reply@house.mojomo.io';
    checkSenderDomain();
    expect(errors.join(' ')).toContain('does not match');
    expect(errors.join(' ')).toContain('house.mojomo.io');
  });

  it('warns when MAIL_FROM is not an address', () => {
    process.env.MAIL_FROM = 'not-an-address';
    checkSenderDomain();
    expect(errors.join(' ')).toContain('not an address');
  });

  it('warns when PUBLIC_URL is malformed', () => {
    process.env.PUBLIC_URL = 'not a url';
    process.env.MAIL_FROM = 'no-reply@mojomo.io';
    checkSenderDomain();
    expect(errors.join(' ')).toContain('PUBLIC_URL');
  });
});
