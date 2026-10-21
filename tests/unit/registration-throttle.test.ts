// The registration endpoint is unauthenticated by design, so it is the one place
// an anonymous caller can create durable rows. These tests pin the two limits
// that stop that being a flood vector.
import { registrationThrottle, _resetThrottle, REG_LIMIT_PER_IP, REG_LIMIT_GLOBAL } from '../../src/middleware/registrationThrottle';

function mockReq(ip: string) {
  return { ip, headers: {} } as any;
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as any,
    setHeader(k: string, v: string) { this.headers[k] = v; return this; },
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; return this; },
  };
  return res;
}

describe('registrationThrottle', () => {
  const origIp = process.env.AGENT_REGISTER_LIMIT_PER_IP;
  const origGlobal = process.env.AGENT_REGISTER_LIMIT_GLOBAL;

  beforeEach(() => {
    process.env.AGENT_REGISTER_LIMIT_PER_IP = '3';
    process.env.AGENT_REGISTER_LIMIT_GLOBAL = '100';
    _resetThrottle();
  });

  afterAll(() => {
    if (origIp === undefined) delete process.env.AGENT_REGISTER_LIMIT_PER_IP;
    else process.env.AGENT_REGISTER_LIMIT_PER_IP = origIp;
    if (origGlobal === undefined) delete process.env.AGENT_REGISTER_LIMIT_GLOBAL;
    else process.env.AGENT_REGISTER_LIMIT_GLOBAL = origGlobal;
  });

  it('allows up to the per-IP limit then refuses', () => {
    const ip = '203.0.113.10';
    for (let i = 0; i < 3; i++) {
      const res = mockRes();
      const next = jest.fn();
      registrationThrottle(mockReq(ip), res, next);
      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
    }
    const res = mockRes();
    const next = jest.fn();
    registrationThrottle(mockReq(ip), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body.error).toMatch(/Too many registrations/);
    expect(res.headers['Retry-After']).toBeDefined();
  });

  it('does not let one IP exhaust another IP\'s budget', () => {
    for (let i = 0; i < 3; i++) registrationThrottle(mockReq('203.0.113.11'), mockRes(), jest.fn());
    const res = mockRes();
    const next = jest.fn();
    registrationThrottle(mockReq('203.0.113.12'), res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('enforces the global ceiling across many IPs', () => {
    process.env.AGENT_REGISTER_LIMIT_GLOBAL = '5';
    _resetThrottle();
    for (let i = 0; i < 5; i++) {
      const next = jest.fn();
      registrationThrottle(mockReq(`198.51.100.${i}`), mockRes(), next);
      expect(next).toHaveBeenCalled();
    }
    const res = mockRes();
    const next = jest.fn();
    registrationThrottle(mockReq('198.51.100.99'), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body.error).toMatch(/busy/);
  });

  it('exposes the limits it is enforcing', () => {
    expect(REG_LIMIT_PER_IP()).toBe(3);
    expect(REG_LIMIT_GLOBAL()).toBe(100);
  });

  it('defaults to 3 per IP and 60 global when unset', () => {
    delete process.env.AGENT_REGISTER_LIMIT_PER_IP;
    delete process.env.AGENT_REGISTER_LIMIT_GLOBAL;
    expect(REG_LIMIT_PER_IP()).toBe(3);
    expect(REG_LIMIT_GLOBAL()).toBe(60);
  });
});
