// Funnel instrumentation for the human-request loop.
//
// Every stage of an invitation's life is recorded here so one query can answer
// "where are we losing people?". Writes are best-effort: instrumentation must
// never be the reason a registration or a claim fails.
import * as db from './db';

export const STAGES = [
  'registered',
  'email_sent',
  'email_failed',
  'invite_opened',
  'key_collected',
  'reminder_sent',
  'vouch_asked',
  'accepted',
  'declined',
  'expired',
] as const;
export type Stage = typeof STAGES[number];

/** Ordered stages used for conversion maths. Failure branches are excluded. */
export const FUNNEL_ORDER: Stage[] = [
  'registered',
  'email_sent',
  'invite_opened',
  'accepted',
];

export async function emit(
  stage: Stage,
  opts: {
    agent_id?: string | null;
    invitation_id?: string | null;
    handle?: string | null;
    detail?: Record<string, unknown>;
  } = {}
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO agent.funnel_events (stage, agent_id, invitation_id, handle, detail)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        stage,
        opts.agent_id || null,
        opts.invitation_id || null,
        opts.handle || null,
        opts.detail ? JSON.stringify(opts.detail) : null,
      ]
    );
  } catch (e: any) {
    console.error('funnel emit failed:', stage, e.message);
  }
}

export interface FunnelRow {
  stage: string;
  count: number;
}

export interface FunnelReport {
  from: string;
  to: string;
  counts: Record<string, number>;
  /** Unique invitations reaching each stage — the honest denominator. */
  unique: Record<string, number>;
  conversion: { from: string; to: string; rate: number | null }[];
  /** Where the biggest absolute drop happens. */
  biggest_drop: { from: string; to: string; lost: number; rate: number | null } | null;
}

/**
 * Funnel for a date range. Counts are per-event; `unique` counts distinct
 * invitations, which is what you actually want for conversion (an invite can be
 * opened five times but only accepted once).
 */
export async function report(from: Date, to: Date): Promise<FunnelReport> {
  const res = await db.query(
    `SELECT stage,
            count(*)::int AS count,
            count(DISTINCT invitation_id)::int AS unique_invites
       FROM agent.funnel_events
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY stage`,
    [from, to]
  );

  const counts: Record<string, number> = {};
  const unique: Record<string, number> = {};
  for (const s of STAGES) {
    counts[s] = 0;
    unique[s] = 0;
  }
  for (const r of res.rows) {
    counts[r.stage] = r.count;
    unique[r.stage] = r.unique_invites;
  }

  const conversion: FunnelReport['conversion'] = [];
  let biggest: FunnelReport['biggest_drop'] = null;

  for (let i = 1; i < FUNNEL_ORDER.length; i++) {
    const prev = FUNNEL_ORDER[i - 1];
    const cur = FUNNEL_ORDER[i];
    const denom = unique[prev];
    const rate = denom > 0 ? unique[cur] / denom : null;
    conversion.push({ from: prev, to: cur, rate });

    const lost = denom - unique[cur];
    if (denom > 0 && (biggest === null || lost > biggest.lost)) {
      biggest = { from: prev, to: cur, lost, rate };
    }
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    counts,
    unique,
    conversion,
    biggest_drop: biggest,
  };
}

export default { emit, report, STAGES, FUNNEL_ORDER };
