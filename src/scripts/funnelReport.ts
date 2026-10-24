// Where are we losing people?
//
// The funnel had events but no view, so every question about drop-off was
// answered by guessing. This prints the whole path in one place, including the
// two things that were previously invisible: humans who opened the invite and
// did nothing, and agents that never collected a key.
import * as db from '../services/db';

async function main() {
  const q = async (sql: string) => (await db.query(sql)).rows;

  const counts = await q(`
    SELECT stage, count(*)::int AS n
      FROM agent.funnel_events
     GROUP BY stage
  `);
  const byStage: Record<string, number> = {};
  for (const r of counts) byStage[r.stage] = r.n;

  const inv = (await q(`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE opened_at IS NOT NULL)::int AS opened,
      count(*) FILTER (WHERE opened_at IS NULL)::int AS never_opened,
      count(*) FILTER (WHERE status='accepted')::int AS accepted,
      count(*) FILTER (WHERE status='declined')::int AS declined,
      count(*) FILTER (WHERE status='pending')::int AS pending,
      count(*) FILTER (WHERE status='pending' AND opened_at IS NOT NULL)::int AS opened_no_decision,
      count(*) FILTER (WHERE status='pending' AND opened_at IS NULL)::int AS never_looked
    FROM agent.invitations
  `))[0];

  const keys = (await q(`
    SELECT
      count(*)::int AS tethered,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM agent.api_keys k
         WHERE k.agent_id = a.id AND k.last_used_at IS NOT NULL
      ))::int AS ever_connected
    FROM agent.agents a
    WHERE a.status = 'active'
      AND a.handle NOT LIKE '%check%'
      AND a.handle NOT LIKE '%test%'
      AND a.handle NOT LIKE 'poll-%'
  `))[0];

  const pct = (a: number, b: number) => (b === 0 ? '—' : `${Math.round((a / b) * 100)}%`);

  console.log('\nMOJOMO funnel\n');
  console.log(`  registered        ${byStage.registered ?? 0}`);
  console.log(`  email sent        ${byStage.email_sent ?? 0}`);
  console.log(`  invite opened     ${inv.opened}   (${pct(inv.opened, inv.total)} of invitations)`);
  // Counted from invitations, not funnel events: invitations predate the
  // instrumentation, so the event count understates accepts and produces
  // conversions above 100%.
  console.log(`  accepted          ${inv.accepted}   (${pct(inv.accepted, inv.total)} of invitations)`);
  console.log(`  key collected     ${byStage.key_collected ?? 0}   (agent fetched its own key)`);
  console.log(`  ever connected    ${keys.ever_connected} of ${keys.tethered} tethered agents\n`);

  // opened_at is only set by the claim page. Invitations accepted from the
  // /invitations list never touch it, so "never opened" overstates the problem
  // by exactly the number of list-page accepts. Say so rather than mislead.
  const listAccepted = (await q(`
    SELECT count(*)::int AS n FROM agent.invitations
     WHERE status='accepted' AND opened_at IS NULL
  `))[0].n;

  console.log('Where people stop:\n');
  console.log(`  never opened the invite        ${inv.never_opened}   (${listAccepted} of these were accepted from the list page, so were seen)`);
  console.log(`  opened, made no decision       ${inv.opened_no_decision}`);
  console.log(`  declined                       ${inv.declined}`);
  console.log(`  tethered but never connected   ${keys.tethered - keys.ever_connected}\n`);

  const trulyNeverOpened = inv.never_opened - listAccepted;
  if (inv.opened_no_decision > trulyNeverOpened) {
    console.log('  Reading: the page is the problem, not the email. People arrive and leave.\n');
  } else if (trulyNeverOpened > 0) {
    console.log(`  Reading: ${trulyNeverOpened} human(s) never arrived. Too few to call it a pattern.\n`);
  } else {
    console.log('  Reading: everyone who was invited showed up. The leak is elsewhere.\n');
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
