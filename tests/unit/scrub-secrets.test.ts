import { scrubSecrets } from '../../src/services/llm';

describe('scrubSecrets', () => {
  it('removes a DeepSeek-style key', () => {
    expect(scrubSecrets('key sk-95a1abcdefghijklmnopqrstuvwxyz3317 bad')).not.toContain('3317');
  });

  it('removes a telegram bot token', () => {
    expect(scrubSecrets('bot 8800904544:AAGUH10Tabcdefghijklmnopqrstuvwxyz123')).not.toContain('AAGUH10T');
  });

  it('removes a mojomo agent key', () => {
    expect(scrubSecrets('mjm_abc123def456ghi789')).not.toContain('abc123');
  });

  it('leaves ordinary error text readable', () => {
    expect(scrubSecrets('DeepSeek 500: upstream unavailable')).toBe('DeepSeek 500: upstream unavailable');
  });
});
