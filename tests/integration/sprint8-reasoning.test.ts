import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import express from 'express';
import * as db from '../../src/services/db';
import reasoningRoutes from '../../src/routes/reasoning';

let app: express.Application;

describe('Sprint 8: Reasoning Endpoints - Integration Tests', () => {
  let conversation_id: string;
  let avatar1_id: string;
  let avatar2_id: string;
  let user1_id: string;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api', reasoningRoutes);

    user1_id = uuidv4();
    await db.query(
      'INSERT INTO mojomo.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [user1_id, `test-sprint8-${Date.now()}@test.com`]
    );

    avatar1_id = uuidv4();
    avatar2_id = uuidv4();

    await db.query(
      'INSERT INTO mojomo.avatars (id, user_id, name, avatar_type) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8) ON CONFLICT DO NOTHING',
      [
        avatar1_id, user1_id, 'Avatar 1', 'individual',
        avatar2_id, user1_id, 'Avatar 2', 'individual',
      ]
    );

    const convRes = await db.query(
      'INSERT INTO mojomo.conversations (initiator_avatar_id, target_avatar_id, title, total_tokens, ownership_ledger) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [
        avatar1_id,
        avatar2_id,
        'Test Conversation',
        1000,
        JSON.stringify({
          [avatar1_id]: {
            ownership_pct: 50,
            token_balance: 500,
            vested_pct: 0,
            buy_in_amount: 0,
            join_round: 0,
          },
          [avatar2_id]: {
            ownership_pct: 50,
            token_balance: 500,
            vested_pct: 0,
            buy_in_amount: 0,
            join_round: 0,
          },
        }),
      ]
    );

    conversation_id = convRes.rows[0].id;

    // Add test messages
    await db.query(
      'INSERT INTO mojomo.conversation_messages (conversation_id, avatar_id, message_content, message_type) VALUES ($1, $2, $3, $4), ($1, $5, $6, $4)',
      [
        conversation_id,
        avatar1_id,
        'What if we combined approach A with approach B?',
        'user_message',
        avatar2_id,
        'That could work! We should test it.',
      ]
    );
  });

  afterAll(async () => {
    try {
      await db.query(
        'DELETE FROM mojomo.message_queue WHERE conversation_id = $1',
        [conversation_id]
      );
      await db.query(
        'DELETE FROM mojomo.reasoning_logs WHERE conversation_id = $1',
        [conversation_id]
      );
      await db.query(
        'DELETE FROM mojomo.conversation_messages WHERE conversation_id = $1',
        [conversation_id]
      );
      await db.query('DELETE FROM mojomo.conversations WHERE id = $1', [
        conversation_id,
      ]);
      await db.query('DELETE FROM mojomo.avatars WHERE id IN ($1, $2)', [
        avatar1_id,
        avatar2_id,
      ]);
      await db.query('DELETE FROM mojomo.users WHERE id = $1', [user1_id]);
    } catch (e) {}
  });

  describe('POST /api/conversations/:id/reasoning', () => {
    test('creates reasoning job successfully', async () => {
      const res = await request(app)
        .post(`/api/conversations/${conversation_id}/reasoning`)
        .send({})
        .expect(201);

      expect(res.body.reasoning_id).toBeDefined();
      expect(res.body.status).toBe('pending');
      expect(res.body.message_count).toBeGreaterThan(0);
      expect(res.body.token_estimate).toBeGreaterThan(0);
    });

    test('returns 404 for non-existent conversation', async () => {
      const fakeId = uuidv4();
      await request(app)
        .post(`/api/conversations/${fakeId}/reasoning`)
        .send({})
        .expect(404);
    });

    test('accepts custom prompt', async () => {
      const res = await request(app)
        .post(`/api/conversations/${conversation_id}/reasoning`)
        .send({ prompt_override: 'Focus on technical feasibility' })
        .expect(201);

      expect(res.body.reasoning_id).toBeDefined();
    });

    test('creates reasoning_logs record', async () => {
      const res = await request(app)
        .post(`/api/conversations/${conversation_id}/reasoning`)
        .send({})
        .expect(201);

      const logs = await db.query(
        'SELECT * FROM mojomo.reasoning_logs WHERE id = $1',
        [res.body.reasoning_id]
      );

      expect(logs.rows.length).toBe(1);
      expect(logs.rows[0].status).toBe('pending');
    });

    test('creates message_queue job', async () => {
      const res = await request(app)
        .post(`/api/conversations/${conversation_id}/reasoning`)
        .send({})
        .expect(201);

      const jobs = await db.query(
        'SELECT * FROM mojomo.message_queue WHERE reasoning_logs_id = $1',
        [res.body.reasoning_id]
      );

      expect(jobs.rows.length).toBe(1);
      expect(jobs.rows[0].status).toBe('pending');
    });
  });

  describe('GET /api/reasoning-logs/:id', () => {
    test('returns pending reasoning status', async () => {
      const createRes = await request(app)
        .post(`/api/conversations/${conversation_id}/reasoning`)
        .send({})
        .expect(201);

      const getRes = await request(app)
        .get(`/api/reasoning-logs/${createRes.body.reasoning_id}`)
        .expect(200);

      expect(getRes.body.id).toBe(createRes.body.reasoning_id);
      expect(getRes.body.status).toBe('pending');
      expect(getRes.body.response).toBeNull();
    });

    test('returns 404 for non-existent reasoning', async () => {
      const fakeId = uuidv4();
      await request(app)
        .get(`/api/reasoning-logs/${fakeId}`)
        .expect(404);
    });

    test('includes all fields in response', async () => {
      const createRes = await request(app)
        .post(`/api/conversations/${conversation_id}/reasoning`)
        .send({})
        .expect(201);

      const getRes = await request(app)
        .get(`/api/reasoning-logs/${createRes.body.reasoning_id}`)
        .expect(200);

      expect(getRes.body).toHaveProperty('id');
      expect(getRes.body).toHaveProperty('conversation_id');
      expect(getRes.body).toHaveProperty('status');
      expect(getRes.body).toHaveProperty('created_at');
    });
  });

  describe('Error Handling', () => {
    test('handles invalid conversation ID format', async () => {
      await request(app)
        .post('/api/conversations/invalid-uuid/reasoning')
        .send({})
        .expect(404);
    });

    test('handles malformed request body', async () => {
      const res = await request(app)
        .post(`/api/conversations/${conversation_id}/reasoning`)
        .send({ prompt_override: 123 })
        .expect(500);

      expect(res.body.error).toBeDefined();
    });
  });
});
