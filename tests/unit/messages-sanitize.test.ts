import { sanitizeMessageContent } from '../../src/services/messages';

describe('sanitizeMessageContent', () => {
  test('removes control characters but keeps newlines and tabs', () => {
    expect(sanitizeMessageContent('a\u0000b\u0007c\nd\te')).toBe('abc\nd\te');
  });
  test('trims surrounding whitespace', () => {
    expect(sanitizeMessageContent('   hello  \n')).toBe('hello');
  });
  test('caps at 10000 characters', () => {
    expect(sanitizeMessageContent('x'.repeat(12000)).length).toBe(10000);
  });
  test('returns empty string for control-only input', () => {
    expect(sanitizeMessageContent('\u0001\u0002')).toBe('');
  });
});
