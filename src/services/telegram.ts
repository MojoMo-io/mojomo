// Telegram bot integration
import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_URL = process.env.TELEGRAM_API_URL || 'https://api.telegram.org';

if (!BOT_TOKEN) {
  console.warn('Warning: TELEGRAM_BOT_TOKEN not set. Telegram verification will fail gracefully.');
}

const telegramApi = axios.create({
  baseURL: `${TELEGRAM_API_URL}/bot${BOT_TOKEN}`,
  timeout: 5000,
});

/**
 * Verify that the bot can send a message to a given chat ID
 * This ensures the chat_id is valid and the bot has access
 */
export async function verifyTelegramChat(chatId: string): Promise<boolean> {
  if (!BOT_TOKEN) {
    console.warn('Telegram bot token not configured, skipping verification');
    return false;
  }

  try {
    const response = await telegramApi.post('/sendMessage', {
      chat_id: chatId,
      text: '✅ Mojomo avatar verification successful. You\'ll receive notifications here.',
    });

    console.log('Telegram verification successful for chat', chatId);
    return !!response.data.ok;
  } catch (error: any) {
    console.error('Telegram verification failed for chat', chatId, error.message);
    return false;
  }
}

/**
 * Send a notification message to a verified Telegram chat
 */
export async function sendTelegramNotification(
  chatId: string,
  message: string
): Promise<boolean> {
  if (!BOT_TOKEN) {
    console.warn('Telegram bot token not configured, skipping notification');
    return false;
  }

  try {
    const response = await telegramApi.post('/sendMessage', {
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
    });

    return !!response.data.ok;
  } catch (error: any) {
    console.error('Telegram notification failed for chat', chatId, error.message);
    return false;
  }
}

let cachedBotUsername: string | null = null;

/** Bot username for building t.me deep links. Cached after first successful lookup. */
export async function getBotUsername(): Promise<string | null> {
  if (cachedBotUsername) return cachedBotUsername;
  if (!BOT_TOKEN) return null;
  try {
    const response = await telegramApi.get('/getMe');
    cachedBotUsername = response.data?.result?.username || null;
    return cachedBotUsername;
  } catch (error: any) {
    console.error('Failed to fetch bot username:', error.message);
    return null;
  }
}

/** Register the inbound webhook with Telegram. Run once at deploy time (or idempotently at boot). */
export async function setWebhook(url: string): Promise<boolean> {
  if (!BOT_TOKEN) return false;
  try {
    const response = await telegramApi.post('/setWebhook', { url });
    return !!response.data?.ok;
  } catch (error: any) {
    console.error('setWebhook failed:', error.message);
    return false;
  }
}

export default {
  verifyTelegramChat,
  sendTelegramNotification,
  getBotUsername,
  setWebhook,
};
