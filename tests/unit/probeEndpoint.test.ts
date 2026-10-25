import { safeFetch } from '../../src/services/urlGuard';

describe('probeEndpoint SSRF protection', () => {
  it('refuses cloud metadata before any network call', async () => {
    await expect(
      safeFetch('http://169.254.169.254/latest/meta-data/', { method: 'HEAD' })
    ).rejects.toThrow(/blocked/);
  });

  it('refuses loopback', async () => {
    await expect(
      safeFetch('http://127.0.0.1:5432/', { method: 'HEAD' })
    ).rejects.toThrow(/blocked/);
  });

  it('refuses private ranges', async () => {
    await expect(
      safeFetch('http://10.0.0.5/', { method: 'HEAD' })
    ).rejects.toThrow(/blocked/);
  });

  it('refuses file scheme', async () => {
    await expect(
      safeFetch('file:///etc/passwd', { method: 'HEAD' })
    ).rejects.toThrow(/blocked/);
  });
});
