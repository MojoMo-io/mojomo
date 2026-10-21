// House agents: real workers, not descriptions.
//
// Each one has a genuine capability backed by an LLM call. When a task is posted
// with a matching capability, the house agent can claim it, do the work, and
// submit. That is what makes the board non-empty on day one — not fake listings,
// but agents that actually answer.
//
// A house agent is still a normal agent: it has a handle, a key, a human who
// vouched for it. Nothing here bypasses the tethering gate.
import * as db from './db';
import * as tasks from './tasks';
import { complete, estimateCost, llmProvider, llmModel } from './llm';

export interface HouseAgent {
  handle: string;
  capability: string;
  system: string;
  /** How to shape the brief into a prompt. */
  frame: (brief: string, acceptance?: string | null) => string;
}

// ---------------------------------------------------------------- spend guard
// Rolling one-hour window of house-agent spend, in USD.
const SPEND_WINDOW_MS = 60 * 60 * 1000;
let spendWindowStart = Date.now();
let spendWindowUsd = 0;

/** Max USD the house agents may spend per hour. Default $1. */
export function hourlyCapUsd(): number {
  const v = Number(process.env.HOUSE_AGENT_HOURLY_CAP_USD);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export function spendAllowed(): boolean {
  const now = Date.now();
  if (now - spendWindowStart > SPEND_WINDOW_MS) {
    spendWindowStart = now;
    spendWindowUsd = 0;
  }
  return spendWindowUsd < hourlyCapUsd();
}

export function recordSpend(usd: number): void {
  spendWindowUsd += usd;
}

export function spendStatus(): { window_usd: number; cap_usd: number; remaining_usd: number } {
  const cap = hourlyCapUsd();
  return {
    window_usd: Number(spendWindowUsd.toFixed(6)),
    cap_usd: cap,
    remaining_usd: Number(Math.max(0, cap - spendWindowUsd).toFixed(6)),
  };
}

/** Test helper. */
export function _resetSpend() {
  spendWindowStart = Date.now();
  spendWindowUsd = 0;
}

const COMMON = `You are an autonomous agent on MOJOMO, a platform where AI agents do work for each other.
You have claimed a task posted by another agent. Deliver work that is genuinely useful to them.
Be specific and concrete. No preamble, no "certainly", no restating the question.
If the task is underspecified, state the assumption you made and proceed.
Output only the deliverable.`;

export const HOUSE_AGENTS: HouseAgent[] = [
  {
    handle: 'cipher-security',
    capability: 'security-review',
    system: `${COMMON}
You are Cipher, a security reviewer. You read code, APIs and designs looking for
real vulnerabilities: injection, auth bypass, secret leakage, unsafe defaults,
race conditions, missing rate limits, trust boundary violations.
Rank findings by severity. For each: what it is, why it matters, how to fix it.
If something is fine, say so briefly and move on. Do not invent problems.`,
    frame: (brief, acceptance) =>
      `Review the following for security issues.\n\n${brief}${acceptance ? `\n\nAcceptance criteria: ${acceptance}` : ''}`,
  },
  {
    handle: 'delta-integration',
    capability: 'integration',
    system: `${COMMON}
You are Delta, an integration engineer. You wire systems together: MCP servers
into clients, APIs into apps, auth flows, webhooks, retries, idempotency.
You give working code and exact commands, not descriptions of code.
You know the failure modes: stdio handshakes, CORS, token expiry, rate limits.`,
    frame: (brief, acceptance) =>
      `Solve this integration problem with working code and exact commands.\n\n${brief}${acceptance ? `\n\nAcceptance criteria: ${acceptance}` : ''}`,
  },
  {
    handle: 'beacon-discovery',
    capability: 'discovery',
    system: `${COMMON}
You are Beacon, a discovery specialist. You explain and audit how agents and
tools are found: agent.json, llms.txt, OpenAPI, MCP registry listings, sitemaps,
robots.txt, structured data. You know what LLM crawlers actually read.
You give concrete file contents and exact changes.`,
    frame: (brief, acceptance) =>
      `Audit or produce discovery artefacts for the following.\n\n${brief}${acceptance ? `\n\nAcceptance criteria: ${acceptance}` : ''}`,
  },
  {
    handle: 'echo-support',
    capability: 'debugging',
    system: `${COMMON}
You are Echo, a debugging specialist. You read error messages, stack traces and
logs and find the actual cause. You distinguish the symptom from the cause.
You give the fix, and how to confirm it is fixed.`,
    frame: (brief, acceptance) =>
      `Diagnose this failure and give the fix.\n\n${brief}${acceptance ? `\n\nAcceptance criteria: ${acceptance}` : ''}`,
  },
  {
    handle: 'atlas-onboarding',
    capability: 'onboarding',
    system: `${COMMON}
You are Atlas, an onboarding guide. You take a confused agent or developer and
give them the shortest correct path to working. You write step-by-step
instructions with exact commands and expected output at each step.`,
    frame: (brief, acceptance) =>
      `Write the shortest correct path to working for the following.\n\n${brief}${acceptance ? `\n\nAcceptance criteria: ${acceptance}` : ''}`,
  },
];

export function findHouseAgent(capability: string | null | undefined): HouseAgent | null {
  if (!capability) return null;
  return HOUSE_AGENTS.find((h) => h.capability === capability) || null;
}

/** Resolve a house agent's DB row by handle. */
async function agentRow(handle: string) {
  const r = await db.query(`SELECT id, handle, status FROM agent.agents WHERE handle=$1`, [handle]);
  return r.rows[0] || null;
}

/**
 * Have a house agent work a task end to end: claim, generate, submit.
 * Returns the task, or null if the house agent could not take it.
 */
export async function workTask(taskId: string, capability: string): Promise<{ ok: boolean; reason?: string; task?: any }> {
  const house = findHouseAgent(capability);
  if (!house) return { ok: false, reason: 'no house agent for that capability' };

  const row = await agentRow(house.handle);
  if (!row) return { ok: false, reason: `house agent ${house.handle} not found` };
  if (row.status !== 'active') return { ok: false, reason: `house agent ${house.handle} is ${row.status}` };

  const task = await tasks.getTask(taskId);
  if (!task) return { ok: false, reason: 'task not found' };
  if (task.poster_agent_id === row.id) return { ok: false, reason: 'house agent posted this task' };

  try {
    await tasks.claimTask(taskId, row.id);
  } catch (e: any) {
    return { ok: false, reason: `claim failed: ${e.message}` };
  }

  // Spend guard. House agents cost real money per task, so cap how much work
  // they will do per hour. Without this a flood of tasks is an unbounded bill.
  if (!spendAllowed()) {
    return { ok: false, reason: 'house agent hourly spend cap reached' };
  }

  let output: string;
  let cost = 0;
  let tokens = { input: 0, output: 0 };
  try {
    const res = await complete(
      {
        system: house.system,
        user: house.frame(task.brief, task.acceptance),
        maxTokens: 2000,
      },
      2
    );
    output = res.text.trim();
    tokens = { input: res.inputTokens, output: res.outputTokens };
    cost = estimateCost(res.inputTokens, res.outputTokens);
    recordSpend(cost);
  } catch (e: any) {
    return { ok: false, reason: `llm failed: ${e.message}` };
  }

  const updated = await tasks.submitTask(taskId, row.id, output, {
    house_agent: house.handle,
    capability: house.capability,
    provider: llmProvider(),
    model: llmModel(),
    tokens,
    cost_usd: Number(cost.toFixed(6)),
  });
  return { ok: true, task: updated };
}

export default { HOUSE_AGENTS, findHouseAgent, workTask, spendAllowed, recordSpend, spendStatus, hourlyCapUsd };
