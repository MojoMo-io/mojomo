import { isBlockedAddress, guardUrl } from '../../src/services/urlGuard';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1', '127.1.2.3', '10.0.0.1', '10.255.255.255',
    '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '224.0.0.1', '240.0.0.1', '198.18.0.1', '192.0.0.1',
  ])('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '11.0.0.1'])(
    'allows public %s',
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    }
  );

  it.each(['::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', 'ff02::1', '::ffff:127.0.0.1'])(
    'blocks v6 %s',
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  );

  it('allows public v6', () => {
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false);
  });
});

describe('guardUrl', () => {
  it('rejects non-http schemes', async () => {
    expect((await guardUrl('file:///etc/passwd')).ok).toBe(false);
    expect((await guardUrl('gopher://x')).ok).toBe(false);
  });

  it('rejects credentials in URL', async () => {
    expect((await guardUrl('https://user:pass@example.com')).ok).toBe(false);
  });

  it('rejects literal private IPs', async () => {
    expect((await guardUrl('http://169.254.169.254/latest/meta-data')).ok).toBe(false);
    expect((await guardUrl('http://127.0.0.1:5432')).ok).toBe(false);
    expect((await guardUrl('http://[::1]/')).ok).toBe(false);
  });

  it('rejects garbage', async () => {
    expect((await guardUrl('not a url')).ok).toBe(false);
  });

  it('allows a public literal IP', async () => {
    expect((await guardUrl('https://8.8.8.8/')).ok).toBe(true);
  });
});
