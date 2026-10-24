// A retried poll must not leave an agent keyless.
//
// The key is stored hashed, so a second poll cannot return the same key. Before
// this, a poll that timed out after the server had consumed the pickup left the
// agent with nothing. Now a repeat poll re-mints, bounded by a window and a
// count so a leaked invite token cannot be used as a key factory.
import { v4 as uuidv4 } from 'uuid';
import * as db from '../../src/services/db';
import * as agents from '../../src/services/agents';

const handle = `pickup-${uuidv4().slice(0, 8)}`;
let agentId: string;
let invitationId: string;
let userId: string;

beforeAll(async () => {
  const u = await db.query(
    `INSERT INTO mojomo.users (id, email) VALUES ($1, $2) RETURNING id`,
    [uuidv4(), `pickup-${uuidv4().slice(0, 8)}@test.com`]
  );
  userId = u.rows[0].id;
  const a = await db.query(
    `INSERT INTO agent.agents (handle, display_name, status)
     VALUES ($1, $2, 'pending') RETURNING id`,
    [handle, 'Pickup Test']
  );
  agentId = a.rows[0].id;
  const i = await db.query(
    `INSERT INTO agent.invitations (agent_id, token_hash, status, human_email, expires_at)
     VALUES ($1, $2, 'accepted', $3, now() + interval '1 day') RETURNING id`,
    [agentId, `hash-${uuidv4()}`, `pickup-${uuidv4().slice(0, 8)}@test.com`]
  );
  invitationId = i.rows[0].id;
});

afterAll(async () => {
  await db.query('DELETE FROM agent.api_keys WHERE agent_id=$1', [agentId]);
  await db.query('DELETE FROM agent.invitations WHERE agent_id=$1', [agentId]);
  await db.query('DELETE FROM agent.agents WHERE id=$1', [agentId]);
  await db.query('DELETE FROM mojomo.users WHERE id=$1', [userId]);
});

/** Mirrors the claim in the route: consume a pickup if one is available. */
async function pickup(): Promise<boolean> {
  const r = await db.query(
    `UPDATE agent.invitations
        SET key_pickup_hash=NULL,
            key_picked_up_at=COALESCE(key_picked_up_at, now()),
            key_pickup_count=key_pickup_count+1
      WHERE id=$1
        AND (key_pickup_hash IS NOT NULL
             OR (key_picked_up_at > now() - interval '15 minutes' AND key_pickup_count < 3))
      RETURNING key_pickup_count`,
    [invitationId]
  );
  return r.rows.length > 0;
}

it('allows a bounded number of pickups, then closes', async () => {
  await db.query(
    `UPDATE agent.invitations SET key_pickup_hash='parked', key_pickup_count=0 WHERE id=$1`,
    [invitationId]
  );
  expect(await pickup()).toBe(true);  // first
  expect(await pickup()).toBe(true);  // retry
  expect(await pickup()).toBe(true);  // retry
  expect(await pickup()).toBe(false); // closed
  expect(await pickup()).toBe(false); // stays closed
});

it('leaves exactly one live key after repeated pickups', async () => {
  await db.query('DELETE FROM agent.api_keys WHERE agent_id=$1', [agentId]);
  await db.query(`UPDATE agent.agents SET status='active', tether_user_id=$2 WHERE id=$1`, [agentId, userId]);
  await db.query(
    `UPDATE agent.invitations SET key_pickup_hash='parked', key_pickup_count=0, key_picked_up_at=NULL WHERE id=$1`,
    [invitationId]
  );
  for (let n = 0; n < 3; n++) {
    if (!(await pickup())) break;
    await db.query('UPDATE agent.api_keys SET revoked_at=now() WHERE agent_id=$1 AND revoked_at IS NULL', [agentId]);
    await agents.issueKey(agentId, agents.DEFAULT_SCOPES, 'agent-pickup');
  }
  const live = await db.query(
    'SELECT count(*)::int AS n FROM agent.api_keys WHERE agent_id=$1 AND revoked_at IS NULL',
    [agentId]
  );
  expect(live.rows[0].n).toBe(1);
});
