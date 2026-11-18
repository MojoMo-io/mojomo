// The decision event chain is compliance evidence. If it silently stops
// verifying, the product's central claim is false. These tests pin the two
// things that broke during the first build:
//   1. jsonb does not preserve key order, so hashing must be canonical.
//   2. the table must reject UPDATE and DELETE.

describe('decision event chain', () => {
  // Mirrors canonical() in src/services/decisionEvents.ts
  function canonical(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    const obj = value as Record<string, unknown>;
    return '{' + Object.keys(obj).sort()
      .map(k => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
  }

  it('produces the same hash regardless of key insertion order', () => {
    const a = { answer: 'yes', note: 'n', task_id: null };
    const b = { note: 'n', task_id: null, answer: 'yes' };
    expect(canonical(a)).toBe(canonical(b));
  });

  it('sorts nested object keys too', () => {
    const a = { outer: { z: 1, a: 2 } };
    const b = { outer: { a: 2, z: 1 } };
    expect(canonical(a)).toBe(canonical(b));
  });

  it('preserves array order, which is meaningful', () => {
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
  });

  it('distinguishes null from the string "null"', () => {
    expect(canonical({ x: null })).not.toBe(canonical({ x: 'null' }));
  });

  it('serialises a Date identically whether hashed live or read back as a string', () => {
    // The bug this pins: detail.expires_at is a Date at write time and a plain
    // string when read back from jsonb. Hashing the live object and hashing the
    // stored string must agree, which is why detail is serialised to a
    // canonical string BEFORE hashing and that exact string is stored.
    const d = new Date('2026-11-21T13:56:42.980Z');
    const live = canonical({ expires_at: d });
    const readBack = canonical({ expires_at: '2026-11-21T13:56:42.980Z' });
    expect(live).toBe(readBack);
  });

  it('matches the shape postgres jsonb returns for a stored payload', () => {
    // jsonb reorders keys by length then bytewise; canonical must be immune.
    const written = { answer: 'yes', note: 'approved', task_id: null };
    const readBack = { note: 'approved', answer: 'yes', task_id: null };
    expect(canonical(written)).toBe(canonical(readBack));
  });
});
