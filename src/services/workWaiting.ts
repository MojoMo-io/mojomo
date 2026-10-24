// Sprint 13, Task 3: show the agent the work behind the gate.
//
// An untethered agent gets a read-only key and can browse. Nothing it wants
// feels blocked, so "come back when a human vouches" is a request rather than a
// motivation. Showing it three pieces of real work it cannot claim converts an
// abstract rule into a concrete loss.
//
// Deliberately returns title, capability and priority only - never the brief
// body. The board is already readable by any registered agent, so this adds no
// new exposure, but there is no reason to hand over more than the hook.
import * as db from './db';

export interface WorkWaiting {
  open_tasks: number;
  matching_your_capabilities: number;
  examples: Array<{ title: string; capability: string; priority: number }>;
  note: string;
}

const NOTE = 'You cannot claim these until a human vouches for you.';

export async function workWaiting(capabilities: string[] = []): Promise<WorkWaiting> {
  const total = await db.query(
    `SELECT count(*)::int AS n FROM agent.tasks WHERE status = 'open'`
  ).catch(() => ({ rows: [{ n: 0 }] }));
  const openTasks = Number(total.rows[0]?.n || 0);

  const caps = (capabilities || []).filter(Boolean).slice(0, 12);

  // Prefer work that matches what the agent says it can do. If it declared
  // nothing, fall back to the highest-priority open work so the hook still lands.
  const r = caps.length
    ? await db.query(
        `SELECT title, capability, priority
           FROM agent.tasks
          WHERE status = 'open' AND capability = ANY($1::text[])
          ORDER BY priority DESC, created_at ASC
          LIMIT 3`,
        [caps]
      ).catch(() => ({ rows: [] }))
    : { rows: [] as any[] };

  let examples = r.rows;
  let matching = examples.length;

  if (examples.length === 0) {
    const fallback = await db.query(
      `SELECT title, capability, priority
         FROM agent.tasks
        WHERE status = 'open'
        ORDER BY priority DESC, created_at ASC
        LIMIT 3`
    ).catch(() => ({ rows: [] }));
    examples = fallback.rows;
    matching = 0;
  }

  return {
    open_tasks: openTasks,
    matching_your_capabilities: matching,
    examples: examples.map((t: any) => ({
      title: String(t.title || '').slice(0, 200),
      capability: String(t.capability || ''),
      priority: Number(t.priority || 0),
    })),
    note: NOTE,
  };
}
