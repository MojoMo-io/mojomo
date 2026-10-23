/**
 * MAIL_FROM must be on a domain we have declared as a sender.
 *
 * History, because this check has been wrong twice:
 *
 * v1 looked for an MX record. It would not have caught the bug it was written
 * for — house.mojomo.io has MX records, it just does not accept mail for the
 * mailbox we were sending from. 141 notifications bounced over two days.
 *
 * v2 required MAIL_FROM to be on the PUBLIC_URL domain. Too strict: sending
 * transactional mail from a dedicated subdomain is the correct way to keep a
 * bad reputation off the primary domain, and house.mojomo.io already has its
 * own SPF, DKIM and strict-alignment DMARC for exactly that.
 *
 * v3 allows an explicit allowlist via MAIL_ALLOWED_SENDER_DOMAINS.
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
    delete process.env.MAIL_ALLOWED_SENDER_DOMAINS;
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

  it('is silent for an explicitly allowed sender domain', () => {
    process.env.MAIL_FROM = 'house@house.mojomo.io';
    process.env.MAIL_ALLOWED_SENDER_DOMAINS = 'house.mojomo.io';
    checkSenderDomain();
    expect(errors).toEqual([]);
  });

  it('allows a comma-separated list with whitespace', () => {
    process.env.MAIL_FROM = 'house@house.mojomo.io';
    process.env.MAIL_ALLOWED_SENDER_DOMAINS = ' mail.mojomo.io , house.mojomo.io ';
    checkSenderDomain();
    expect(errors).toEqual([]);
  });

  it('warns for an undeclared domain', () => {
    process.env.MAIL_FROM = 'no-reply@house.mojomo.io';
    checkSenderDomain();
    expect(errors.join(' ')).toContain('not a declared sender domain');
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
