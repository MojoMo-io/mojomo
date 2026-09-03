import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import express, { Request, Response } from 'express';
import cors from 'cors';
import * as db from '../../src/services/db';
import avatarRoutes from '../../src/routes/avatars';
import conversationRoutes from '../../src/routes/conversations';
import specialistRoutes from '../../src/routes/specialists';
import payoutRoutes from '../../src/routes/payouts';
import messageRoutes from '../../src/routes/messages';
import ideaRoutes from '../../src/routes/ideas';
import conversationEndRoutes from '../../src/routes/conversation-end';

let app: express.Application;

describe('Sprint 7: Conversation Endpoints - Integration Tests', () => {
  let avatar1_id: string;
  let avatar2_id: string;
  let avatar3_id: string;
  let user1_id: string;
  let user2_id: string;
  let user3_id: string;

  beforeAll(async () => {
    app = express();
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.get('/health', async (req: Request, res: Response) => {
      const isHealthy = await db.healthCheck();
      res.json({ status: isHealthy ? 'healthy' : 'unhealthy' });
    });

    app.use('/api', avatarRoutes);
    app.use('/api', conversationRoutes);
    app.use('/api', specialistRoutes);
    app.use('/api', payoutRoutes);
    app.use('/api', messageRoutes);
    app.use('/api', ideaRoutes);
    app.use('/api', conversationEndRoutes);

    app.use((req: Request, res: Response) => {
      res.status(404).json({ error: 'Not found' });
    });

    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error('Unhandled error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });

    user1_id = uuidv4();
    user2_id = uuidv4();
    user3_id = uuidv4();

    await db.query(
      'INSERT INTO mojomo.users (id, email) VALUES ($1, $2), ($3, $4), ($5, $6) ON CONFLICT DO NOTHING',
      [user1_id, `user1-${Date.now()}@test.com`, user2_id, `user2-${Date.now()}@test.com`, user3_id, `user3-${Date.now()}@test.com`]
    );

    avatar1_id = uuidv4();
    avatar2_id = uuidv4();
    avatar3_id = uuidv4();

    await db.query(
      'INSERT INTO mojomo.avatars (id, user_id, name, avatar_type) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8), ($9, $10, $11, $12) ON CONFLICT DO NOTHING',
      [
        avatar1_id, user1_id, 'Avatar 1', 'individual',
        avatar2_id, user2_id, 'Avatar 2', 'individual',
        avatar3_id, user3_id, 'Avatar 3', 'individual',
      ]
    );
  });

  afterEach(async () => {
    try {
      await db.query('DELETE FROM mojomo.conversation_events WHERE conversation_id IN (SELECT id FROM mojomo.conversations WHERE initiator_avatar_id IN ($1, $2, $3))', [avatar1_id, avatar2_id, avatar3_id]);
      await db.query('DELETE FROM mojomo.token_ledger WHERE conversation_id IN (SELECT id FROM mojomo.conversations WHERE initiator_avatar_id IN ($1, $2, $3))', [avatar1_id, avatar2_id, avatar3_id]);
      await db.query('DELETE FROM mojomo.conversations WHERE initiator_avatar_id IN ($1, $2, $3)', [avatar1_id, avatar2_id, avatar3_id]);
    } catch (e) {}
  });

  afterAll(async () => {
    try {
      await db.query('DELETE FROM mojomo.conversation_events');
      await db.query('DELETE FROM mojomo.token_ledger');
      await db.query('DELETE FROM mojomo.conversations');
      await db.query('DELETE FROM mojomo.avatars WHERE id IN ($1, $2, $3)', [avatar1_id, avatar2_id, avatar3_id]);
      await db.query('DELETE FROM mojomo.users WHERE id IN ($1, $2, $3)', [user1_id, user2_id, user3_id]);
    } catch (e) {}
  });

  describe('POST /api/conversations', () => {
    test('creates conversation with valid payload', async () => {
      const res = await request(app)
        .post('/api/conversations')
        .send({
          initiator_avatar_id: avatar1_id,
          target_avatar_id: avatar2_id,
          title: 'Test Conversation',
          total_tokens: 1000,
          description: 'A test conversation',
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.initiator_avatar_id).toBe(avatar1_id);
      expect(res.body.target_avatar_id).toBe(avatar2_id);
      expect(res.body.total_tokens).toBe(1000);
    });

    test('rejects same avatar for both', async () => {
      const res = await request(app)
        .post('/api/conversations')
        .send({
          initiator_avatar_id: avatar1_id,
          target_avatar_id: avatar1_id,
          title: 'Same Avatar',
          total_tokens: 1000,
        })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    test('rejects zero tokens', async () => {
      await request(app)
        .post('/api/conversations')
        .send({
          initiator_avatar_id: avatar1_id,
          target_avatar_id: avatar2_id,
          title: 'Zero',
          total_tokens: 0,
        })
        .expect(400);
    });

    test('rejects missing required fields', async () => {
      await request(app)
        .post('/api/conversations')
        .send({
          initiator_avatar_id: avatar1_id,
          title: 'Missing target',
          total_tokens: 1000,
        })
        .expect(400);
    });
  });

  describe('GET /api/conversations/:id', () => {
    let conversationId: string;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/conversations')
        .send({
          initiator_avatar_id: avatar1_id,
          target_avatar_id: avatar2_id,
          title: 'Retrieve Test',
          total_tokens: 1000,
        });
      conversationId = res.body.id;
    });

    test('retrieves existing conversation', async () => {
      const res = await request(app)
        .get(`/api/conversations/${conversationId}`)
        .expect(200);

      expect(res.body.id).toBe(conversationId);
      expect(res.body.title).toBe('Retrieve Test');
    });

    test('returns 404 for non-existent', async () => {
      await request(app)
        .get(`/api/conversations/${uuidv4()}`)
        .expect(404);
    });
  });

  describe('GET /api/conversations/:id/ownership', () => {
    let conversationId: string;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/conversations')
        .send({
          initiator_avatar_id: avatar1_id,
          target_avatar_id: avatar2_id,
          title: 'Ownership Test',
          total_tokens: 2000,
        });
      conversationId = res.body.id;
    });

    test('returns ownership with validation', async () => {
      const res = await request(app)
        .get(`/api/conversations/${conversationId}/ownership`)
        .expect(200);

      expect(res.body.is_valid).toBe(true);
      expect(res.body.total_tokens).toBe(2000);
    });
  });

  describe('GET /api/conversations/:id/avatars/:avatar_id/ownership', () => {
    let conversationId: string;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/conversations')
        .send({
          initiator_avatar_id: avatar1_id,
          target_avatar_id: avatar2_id,
          title: 'Avatar Ownership',
          total_tokens: 1000,
        });
      conversationId = res.body.id;
    });

    test('returns avatar ownership', async () => {
      const res = await request(app)
        .get(`/api/conversations/${conversationId}/avatars/${avatar1_id}/ownership`)
        .expect(200);

      expect(res.body.avatar_id).toBe(avatar1_id);
      expect(res.body.total_tokens).toBe(500);
      expect(res.body.ownership_pct).toBe(50);
      expect(res.body.vested_pct).toBe(0);
    });

    test('returns 404 for avatar not in conversation', async () => {
      await request(app)
        .get(`/api/conversations/${conversationId}/avatars/${avatar3_id}/ownership`)
        .expect(404);
    });
  });

  describe('GET /api/conversations (list)', () => {
    beforeEach(async () => {
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/api/conversations')
          .send({
            initiator_avatar_id: avatar1_id,
            target_avatar_id: avatar2_id,
            title: `Conv ${i}`,
            total_tokens: 100 + i * 50,
          });
      }
    });

    test('requires x-user-id header', async () => {
      const res = await request(app)
        .get('/api/conversations')
        .expect(401);

      expect(res.body.error).toBeDefined();
    });

    test('returns conversations for user', async () => {
      const res = await request(app)
        .get('/api/conversations')
        .set('x-user-id', user1_id)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('Conversation Genesis Allocation - E2E', () => {
    test('creates conversation with correct 50/50 split', async () => {
      const res = await request(app)
        .post('/api/conversations')
        .send({
          initiator_avatar_id: avatar1_id,
          target_avatar_id: avatar2_id,
          title: 'Genesis Test',
          total_tokens: 5000,
        })
        .expect(201);

      expect(res.body.ownership_ledger[avatar1_id].token_balance).toBe(2500);
      expect(res.body.ownership_ledger[avatar2_id].token_balance).toBe(2500);
      expect(res.body.ownership_ledger[avatar1_id].ownership_pct).toBe(50);
      expect(res.body.ownership_ledger[avatar2_id].ownership_pct).toBe(50);
    });

    test('handles fractional tokens in genesis', async () => {
      const res = await request(app)
        .post('/api/conversations')
        .send({
          initiator_avatar_id: avatar1_id,
          target_avatar_id: avatar2_id,
          title: 'Fractional',
          total_tokens: 123.45,
        })
        .expect(201);

      const total = res.body.ownership_ledger[avatar1_id].token_balance + res.body.ownership_ledger[avatar2_id].token_balance;
      expect(total).toBeCloseTo(123.45, 2);
    });

    test('full conversation lifecycle', async () => {
      const createRes = await request(app)
        .post('/api/conversations')
        .send({
          initiator_avatar_id: avatar1_id,
          target_avatar_id: avatar2_id,
          title: 'Lifecycle',
          total_tokens: 1000,
        })
        .expect(201);

      const convId = createRes.body.id;

      const getRes = await request(app)
        .get(`/api/conversations/${convId}`)
        .expect(200);

      expect(getRes.body.id).toBe(convId);

      const ownershipRes = await request(app)
        .get(`/api/conversations/${convId}/ownership`)
        .expect(200);

      expect(ownershipRes.body.is_valid).toBe(true);

      const listRes = await request(app)
        .get('/api/conversations')
        .set('x-user-id', user1_id)
        .expect(200);

      expect(listRes.body.some((c: any) => c.id === convId)).toBe(true);
    });
  });
});
