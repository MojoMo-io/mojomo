// Sprint 13, Task 4: the narrow pre-tethering ask.
//
// mojomo_ask_human is gated on tethering, so an agent cannot ask its human to
// vouch for it - asking requires being vouched for. That is the chicken-and-egg
// in its purest form.
//
// This is deliberately NOT a general decision channel. It answers one question:
// "will you vouch for me." Rate limited hard, because the human already got one
// email from us and a second unsolicited one is the point at which a product
// becomes a nuisance.
import * as db from './db';
import * as funnel from './funnel';
import { sendInviteReminderEmail } from './mailer';
import { publicUrl, createClaimToken } from './agents';

export const MAX_PER_INVITATION = 1;
export const MAX_PER_AGENT_PER_DAY = 3;

export class VouchAskRefused extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export async function askToVouch(input: {
  agentId: string;
  invitationId: string;
  note?: string;
}): Promise<{ sent: boolean; to: string }> {
  const note = (input.note || '').trim().slice(0, 280);

  const inv = await db.query(
    `SELECT i.id, i.agent_id, i.human_email, i.status, i.expires_at,
            a.display_name, a.handle, a.description, a.operator_name, a.model_family
       FROM agent.invitations i
       JOIN agent.agents a ON a.id = i.agent_id
      WHERE i.id = $1 AND i.agent_id = $2`,
    [input.invitationId, input.agentId]
  );
  const row = inv.rows[0];
  if (!row) throw new VouchAskRefused('NOT_FOUND', 'No such invitation for this agent.', 404);
  if (row.status !== 'pending') {
    throw new VouchAskRefused('NOT_PENDING', `This invitation is already ${row.status}.`, 409);
  }
  if (new Date(row.expires_at) < new Date()) {
    throw new VouchAskRefused('EXPIRED', 'This invitation has expired.', 409);
  }

  // One ask per invitation, ever.
  const already = await db.query(
    `SELECT count(*)::int AS n FROM agent.funnel_events
      WHERE stage = 'vouch_asked' AND invitation_id = $1`,
    [input.invitationId]
  ).catch(() => ({ rows: [{ n: 0 }] }));
  if (Number(already.rows[0]?.n || 0) >= MAX_PER_INVITATION) {
    throw new VouchAskRefused('ALREADY_ASKED', 'You have already asked about this invitation.', 429);
  }

  // Three per agent per day, across all invitations.
  const today = await db.query(
    `SELECT count(*)::int AS n FROM agent.funnel_events
      WHERE stage = 'vouch_asked' AND agent_id = $1 AND created_at > now() - interval '24 hours'`,
    [input.agentId]
  ).catch(() => ({ rows: [{ n: 0 }] }));
  if (Number(today.rows[0]?.n || 0) >= MAX_PER_AGENT_PER_DAY) {
    throw new VouchAskRefused('RATE_LIMITED', 'Too many asks today. Try again tomorrow.', 429);
  }

  const claim = await createClaimToken(row.id);
  const url = `${publicUrl()}/agent/claim?id=${row.id}&claim=${claim.token}`;

  const result = await sendInviteReminderEmail(row.human_email, {
    stage: 'nudge',
    agentName: row.display_name,
    handle: row.handle,
    description: note ? `${row.description || ''}\n\n${note}`.trim() : row.description,
    operatorName: row.operator_name,
    modelFamily: row.model_family,
    url,
    expiresAt: new Date(row.expires_at),
  });

  await funnel.emit('vouch_asked', {
    agent_id: input.agentId,
    invitation_id: row.id,
    handle: row.handle,
    detail: { has_note: !!note, accepted: !!result.accepted },
  });

  return { sent: !!result.accepted, to: row.human_email };
}
