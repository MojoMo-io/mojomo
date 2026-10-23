// Ping a human when an agent asks them something urgent.
//
// The inbox only works if you look at it. A high-urgency request that sits
// silently until you happen to visit /decisions is a request you will miss.
import * as db from './db';
import * as telegram from './telegram';
import * as auth from './auth';

const BASE = process.env.PUBLIC_BASE_URL || 'https://mojomo.io';

/** Find a Telegram chat id for a user, via any avatar they own. */
async function chatIdFor(userId: string): Promise<string | null> {
  const r = await db.query(
    `SELECT telegram_chat_id FROM mojomo.avatars
      WHERE user_id = $1 AND telegram_chat_id IS NOT NULL
      LIMIT 1`,
    [userId]
  );
  return r.rows[0]?.telegram_chat_id || null;
}

function esc(s: any): string {
  return String(s ?? '').replace(/([_*`\[\]])/g, '\\$1');
}

/**
 * Notify the human behind a decision request. Only 'high' urgency pings —
 * everything else waits in the inbox, so the ping keeps its meaning.
 */
export async function notifyIfUrgent(req: any): Promise<boolean> {
  if (!req || req.urgency !== 'high') return false;

  const chatId = await chatIdFor(req.tether_user_id);
  if (!chatId) return false;

  const agent = await db.query(
    `SELECT display_name, handle FROM agent.agents WHERE id=$1`,
    [req.agent_id]
  );
  const a = agent.rows[0];
  const who = a ? `${a.display_name} (@${a.handle})` : 'An agent';

  const lines = [
    `*${esc(who)} needs a decision*`,
    '',
    esc(req.title),
  ];
  if (req.body) lines.push('', esc(String(req.body).slice(0, 400)));
  // A one-time login link, so tapping from Telegram lands on the decision
  // already signed in. Falls back to the plain page if minting fails.
  let link = `${BASE}/decisions`;
  try {
    const u = await db.query(`SELECT email FROM mojomo.users WHERE id=$1`, [req.tether_user_id]);
    const email = u.rows[0]?.email;
    if (email) {
      const ml = await auth.createMagicLink(email, '/decisions');
      link = ml.url;
    }
  } catch (e: any) {
    console.error('decision notify: could not mint login link:', e?.message || e);
  }
  lines.push('', `[Answer this](${link})`);

  // Sent from the agent bot when one is configured, so agent questions do not
  // arrive from the human's personal assistant.
  return telegram.sendTelegramNotification(chatId, lines.join('\n'), { as: 'agent' });
}
