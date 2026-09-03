// telegram.ts with axios mocked: no network.
const post = jest.fn();
jest.mock('axios', () => ({ __esModule: true, default: { create: jest.fn(() => ({ post })) } }));
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'test-token';
import { verifyTelegramChat, sendTelegramNotification } from '../../src/services/telegram';

beforeEach(() => post.mockReset());

test('verifyTelegramChat returns true when Telegram answers ok', async () => {
  post.mockResolvedValue({ data: { ok: true } });
  expect(await verifyTelegramChat('123')).toBe(true);
  expect(post).toHaveBeenCalledWith('/sendMessage', expect.objectContaining({ chat_id: '123' }));
});
test('verifyTelegramChat returns false when Telegram answers not ok', async () => {
  post.mockResolvedValue({ data: { ok: false } });
  expect(await verifyTelegramChat('123')).toBe(false);
});
test('verifyTelegramChat swallows network errors', async () => {
  post.mockRejectedValue(new Error('ECONNRESET'));
  expect(await verifyTelegramChat('123')).toBe(false);
});
test('sendTelegramNotification uses Markdown and reports ok/failure', async () => {
  post.mockResolvedValue({ data: { ok: true } });
  expect(await sendTelegramNotification('9', '*hi*')).toBe(true);
  expect(post).toHaveBeenCalledWith('/sendMessage', expect.objectContaining({ parse_mode: 'Markdown', text: '*hi*' }));
  post.mockRejectedValue(new Error('403 Forbidden: bot was blocked'));
  expect(await sendTelegramNotification('9', 'x')).toBe(false);
});
