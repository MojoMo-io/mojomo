// Sprint 10: coverage for the public NPC surface and the admin dashboard endpoints.
// Written because a `jsonb -> uuid` type bug shipped in /api/admin/avatars/:id/ledger
// with no test exercising it — the service crash-looped in production.
import request from 'supertest';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../../src/services/db';
jest.mock('../../src/services/telegram', () => ({
  verifyTelegramChat: jest.fn().mockResolvedValue(false),
  sendTelegramNotification: jest.fn().mockResolvedValue(true),
}));
import { createHash } from 'crypto';
import agentRoutes from '../../src/routes/agentApi';
import adminRoutes from '../../src/routes/admin';
import { attachSession } from '../../src/middleware/auth';

let app: express.Application;
const userId = uuidv4();
const npcId = uuidv4();
const npcPromptId = uuidv4();
const humanAvatarId = uuidv4();
const convId = uuidv4();

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use('/api', agentRoutes);
  app.use('/api', attachSession, adminRoutes);

  await db.query('INSERT INTO mojomo.users (id, email, is_admin) VALUES ($1,$2,true)', [userId, `s10-${Date.now()}@test.com`]);
  await db.query(
    `INSERT INTO mojomo.avatars (id, user_id, name, avatar_type, is_npc, bio)
     VALUES ($1,$3,'S10 Human','individual',false,'A human avatar.'),
            ($2,$3,'S10 NPC','individual',true,'A clean NPC bio.'),
            ($4,$3,'S10 PromptNPC','individual',true,'You are a test NPC. Secret instructions here.')`,
    [humanAvatarId, npcId, userId, npcPromptId]
  );
  await db.query(
    `INSERT INTO mojomo.conversations (id, initiator_avatar_id, target_avatar_id, title, status, total_tokens, ownership_ledger)
     VALUES ($1,$2,$3,'S10 conversation','active',1000,$4::jsonb)`,
    [convId, humanAvatarId, npcId, JSON.stringify({
      [humanAvatarId]: { ownership_pct: 50, token_balance: 500, buy_in_amount: 0, join_round: 0 },
      [npcId]: { ownership_pct: 50, token_balance: 500, buy_in_amount: 0, join_round: 0 },
    })]
  );
  await db.query(
    `INSERT INTO mojomo.conversation_messages (conversation_id, avatar_id, message_content, message_type)
     VALUES ($1,$2,'Hello from the human.','avatar_message'), ($1,$3,'Hello from the NPC.','ai_response')`,
    [convId, humanAvatarId, npcId]
  );
});

afterAll(async () => {
  await db.query('DELETE FROM mojomo.conversation_messages WHERE conversation_id = $1', [convId]);
  await db.query('DELETE FROM mojomo.conversations WHERE id = $1', [convId]);
  await db.query('DELETE FROM mojomo.users WHERE id = $1', [userId]);
});

describe('GET /api/npc-avatars (public)', () => {
  it('answers without any authentication', async () => {
    const r = await request(app).get('/api/npc-avatars');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(Array.isArray(r.body.npcs)).toBe(true);
  });

  it('lists the seeded NPCs', async () => {
    const r = await request(app).get('/api/npc-avatars');
    const names = r.body.npcs.map((n: any) => n.name);
    expect(names).toContain('S10 NPC');
    expect(names).toContain('S10 PromptNPC');
  });

  it('never exposes a system prompt pasted into bio', async () => {
    const r = await request(app).get('/api/npc-avatars');
    const blob = JSON.stringify(r.body.npcs);
    expect(blob).not.toContain('Secret instructions');
    const promptNpc = r.body.npcs.find((n: any) => n.name === 'S10 PromptNPC');
    expect(promptNpc.bio).toBeNull();
  });

  it('returns a real bio when the bio is a real bio', async () => {
    const r = await request(app).get('/api/npc-avatars');
    const clean = r.body.npcs.find((n: any) => n.name === 'S10 NPC');
    expect(clean.bio).toBe('A clean NPC bio.');
  });

  it('does not leak user ids or system prompts', async () => {
    const r = await request(app).get('/api/npc-avatars');
    const blob = JSON.stringify(r.body.npcs);
    expect(blob).not.toContain(userId);
    expect(blob).not.toContain('system_prompt');
  });
});

describe('admin endpoints require a session', () => {
  it('GET /api/admin/conversations is 401 without a session', async () => {
    const r = await request(app).get('/api/admin/conversations');
    expect(r.status).toBe(401);
  });

  it('GET /api/admin/conversations/:id/messages is 401 without a session', async () => {
    const r = await request(app).get(`/api/admin/conversations/${convId}/messages`);
    expect(r.status).toBe(401);
  });

  it('GET /api/admin/avatars/:id/ledger is 401 without a session', async () => {
    const r = await request(app).get(`/api/admin/avatars/${npcId}/ledger`);
    expect(r.status).toBe(401);
  });
});

describe('admin endpoints with a real admin session', () => {
  let cookie: string;

  beforeAll(async () => {
    const raw = 's10-' + uuidv4() + uuidv4();
    const hash = createHash('sha256').update(raw).digest('hex');
    await db.query(
      `INSERT INTO mojomo.sessions (user_id, token_hash, expires_at) VALUES ($1,$2,NOW()+interval '10 min')`,
      [userId, hash]
    );
    cookie = `mojomo_session=${raw}`;
  });

  afterAll(async () => {
    await db.query('DELETE FROM mojomo.sessions WHERE user_id = $1', [userId]);
  });

  it('GET /api/admin/conversations returns rows with joined avatar names', async () => {
    const r = await request(app).get('/api/admin/conversations').set('Cookie', cookie);
    expect(r.status).toBe(200);
    const row = r.body.find((c: any) => c.id === convId);
    expect(row).toBeDefined();
    expect(row.initiator_name).toBe('S10 Human');
    expect(row.target_name).toBe('S10 NPC');
    expect(row.involves_npc).toBe(true);
  });

  it('GET /api/admin/conversations/:id/messages joins avatar_name', async () => {
    const r = await request(app)
      .get(`/api/admin/conversations/${convId}/messages`)
      .set('Cookie', cookie);
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(2);
    expect(r.body[0].avatar_name).toBe('S10 Human');
    expect(r.body[1].avatar_name).toBe('S10 NPC');
    expect(r.body[1].is_npc).toBe(true);
  });

  // REGRESSION: this route used $1 as both a jsonb key and a uuid. Postgres has no
  // `jsonb -> uuid` operator, the query threw, and the unhandled error crash-looped the
  // service in production. This test exists so that cannot happen silently again.
  it('GET /api/admin/avatars/:id/ledger returns the ledger entry (jsonb key + uuid)', async () => {
    const r = await request(app)
      .get(`/api/admin/avatars/${npcId}/ledger`)
      .set('Cookie', cookie);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    const row = r.body.find((x: any) => x.id === convId);
    expect(row).toBeDefined();
    expect(row.entry).toBeTruthy();
    expect(Number(row.entry.ownership_pct)).toBe(50);
    expect(Number(row.entry.token_balance)).toBe(500);
  });

  it('ledger returns an empty array for an avatar with no conversations', async () => {
    const r = await request(app)
      .get(`/api/admin/avatars/${uuidv4()}/ledger`)
      .set('Cookie', cookie);
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });
});
