import { auditPhpEndpoint } from '../../src/services/phpAudit';

const mockFetch = jest.fn();
beforeEach(() => { mockFetch.mockReset(); global.fetch = mockFetch as any; });

function res(body: string, headers: Record<string,string> = {}, status = 200) {
  return {
    status, ok: status < 400,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => body,
  } as any;
}

describe('auditPhpEndpoint', () => {
  it('refuses to audit a private address', async () => {
    const r = await auditPhpEndpoint('http://127.0.0.1/');
    expect(r.reachable).toBe(false);
    expect(r.findings[0].id).toBe('unreachable');
  });

  it('flags end-of-life PHP', async () => {
    mockFetch.mockResolvedValue(res('<html>ok</html>', { server: 'Apache/2.4 PHP/7.4.3' }));
    const r = await auditPhpEndpoint('https://8.8.8.8/');
    const ids = r.findings.map(f => f.id);
    expect(ids).toContain('php-eol');
    expect(ids).toContain('php-version-disclosed');
  });

  it('does not flag current PHP as EOL', async () => {
    mockFetch.mockResolvedValue(res('<html>ok</html>', { server: 'nginx PHP/8.3.2' }));
    const r = await auditPhpEndpoint('https://8.8.8.8/');
    expect(r.findings.map(f => f.id)).not.toContain('php-eol');
  });

  it('flags verbose error disclosure', async () => {
    mockFetch.mockResolvedValue(res(
      'Fatal error: Uncaught PDOException in /var/www/app/db.php on line 12',
      { server: 'Apache' }
    ));
    const ids = (await auditPhpEndpoint('https://8.8.8.8/')).findings.map(f => f.id);
    expect(ids).toContain('err-path');
    expect(ids).toContain('err-sql');
  });

  it('flags credentials in the body as critical', async () => {
    mockFetch.mockResolvedValue(res('DB_PASSWORD=hunter2', { server: 'Apache' }));
    const r = await auditPhpEndpoint('https://8.8.8.8/');
    const f = r.findings.find(x => x.id === 'err-secret');
    expect(f?.severity).toBe('critical');
  });

  it('flags missing security headers', async () => {
    mockFetch.mockResolvedValue(res('<html>ok</html>', { server: 'Apache' }));
    const ids = (await auditPhpEndpoint('https://8.8.8.8/')).findings.map(f => f.id);
    expect(ids).toContain('hdr-frame');
    expect(ids).toContain('hdr-hsts');
  });

  it('does not flag headers that are present', async () => {
    mockFetch.mockResolvedValue(res('<html>ok</html>', {
      server: 'Apache',
      'x-frame-options': 'DENY',
      'strict-transport-security': 'max-age=31536000',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'self'",
    }));
    const ids = (await auditPhpEndpoint('https://8.8.8.8/')).findings.map(f => f.id);
    expect(ids).not.toContain('hdr-frame');
    expect(ids).not.toContain('hdr-hsts');
  });

  it('flags directory listing', async () => {
    mockFetch.mockResolvedValue(res('<title>Index of /</title>', { server: 'Apache' }));
    const ids = (await auditPhpEndpoint('https://8.8.8.8/')).findings.map(f => f.id);
    expect(ids).toContain('dir-listing');
  });

  it('scores a clean endpoint highly', async () => {
    // A server that advertises PHP/8.3.2 still earns a medium finding for
    // disclosing its version, so 100 is not achievable while expose_php is on.
    mockFetch.mockResolvedValue(res('<html>ok</html>', {
      server: 'nginx PHP/8.3.2',
      'x-frame-options': 'DENY',
      'strict-transport-security': 'max-age=31536000',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'self'",
    }));
    const r = await auditPhpEndpoint('https://8.8.8.8/');
    expect(r.score).toBe(92);
  });

  it('sorts findings by severity', async () => {
    mockFetch.mockResolvedValue(res('DB_PASSWORD=x', { server: 'Apache PHP/7.4.0' }));
    const r = await auditPhpEndpoint('https://8.8.8.8/');
    expect(r.findings[0].severity).toBe('critical');
  });
});
