// In-character avatar replies (avatar-to-avatar) and the private human<->own-avatar assistant chat.
// Generalizes what started as an NPC-only concept: every avatar (human-backed or NPC) speaks
// through Claude using its own personality_profile/system_prompt, exactly like an NPC always did.
import { complete } from './llm';
import { Avatar } from '../types';

/** Hard backstop so a Claude misfire can never produce an unbounded avatar-to-avatar exchange. */
export const MAX_CONVERSATION_TURNS = Number(process.env.AVATAR_CONVO_MAX_TURNS || 12);

function avatarVoice(avatar: Avatar): string {
  if (avatar.system_prompt && avatar.system_prompt.trim()) return avatar.system_prompt.trim();
  const p = avatar.personality_profile;
  if (p?.summary) return p.summary;
  return `You are ${avatar.name}'s AI avatar on MOJOMO. You don't know much about ${avatar.name} yet - be warm, curious, and keep replies short while you get to know them.`;
}

/** Strip control chars; same guard as messages.sanitizeMessageContent, duplicated to avoid a cross-import cycle. */
function clip(text: string, max = 4000): string {
  return text.slice(0, max);
}

async function callModel(system: string, userContent: string, maxAttempts = 3): Promise<string> {
  const result = await complete({ system, user: userContent, maxTokens: 512 }, maxAttempts);
  return result.text;
}

/**
 * Generate the next in-character reply for `speaker` in an avatar-to-avatar conversation.
 * `history` is chronological (oldest first); each entry's avatar_id tells us which side spoke.
 */
export async function generateAvatarReply(
  speaker: Avatar,
  otherAvatarName: string,
  history: Array<{ avatar_id: string; message_content: string }>
): Promise<string> {
  const system = `${avatarVoice(speaker)}

You are having a conversation with another MOJOMO avatar named ${otherAvatarName}. Speak as yourself, in your own voice, in 1-4 sentences. This is a real exchange between two people getting to know each other or exploring a shared interest - be substantive, not just pleasant. If the exchange has run its natural course, say a warm, clear goodbye rather than dragging it on.`;

  const transcript = history
    .slice(-10)
    .map((m) => `${m.avatar_id === speaker.id ? 'You' : otherAvatarName}: ${clip(m.message_content, 1000)}`)
    .join('\n');

  const userContent = transcript
    ? `Conversation so far:\n${transcript}\n\nYour reply:`
    : `You're opening this conversation with ${otherAvatarName}. Say a genuine first line - why you wanted to connect.`;

  // Deliberately no fallback text: a placeholder written into the transcript looks like a real
  // message, marks the job completed, and hides a dead model behind plausible-looking filler.
  // Let it throw so the queue records a failure and retries.
  return await callModel(system, userContent);
}

export interface AssistantAction {
  action: 'find_match';
  query: string | null;
}

export interface AssistantReplyResult {
  visibleReply: string;
  action?: AssistantAction;
}

/**
 * Tolerant extraction of a fenced/inline JSON action block, same style as reasoning.ts's
 * parseReasoningJson: models often don't perfectly isolate the block, so find the last
 * top-level {...} that parses and contains an "action" key, and strip it from the visible reply.
 */
export function extractAction(text: string): AssistantReplyResult {
  const fenceMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const candidates: Array<{ raw: string; json: string }> = [];
  if (fenceMatch) candidates.push({ raw: fenceMatch[0], json: fenceMatch[1] });
  // Also look for a bare trailing {...} block containing "action"
  const braceStart = text.lastIndexOf('{"action"');
  if (braceStart !== -1) {
    const braceEnd = text.indexOf('}', braceStart);
    if (braceEnd !== -1) candidates.push({ raw: text.slice(braceStart, braceEnd + 1), json: text.slice(braceStart, braceEnd + 1) });
  }
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c.json);
      if (parsed && parsed.action === 'find_match') {
        return { visibleReply: text.replace(c.raw, '').trim(), action: { action: 'find_match', query: parsed.query ?? null } };
      }
    } catch {
      // not valid JSON, ignore
    }
  }
  return { visibleReply: text.trim() };
}

const ASSISTANT_SYSTEM_SUFFIX = `

You are this person's own private AI avatar on MOJOMO - not a public character, their personal assistant and advocate. Talk to them directly, get to know them over time, and help them think. You never talk to other humans directly - only to your own person, and to other avatars on their behalf.

If they ask you to connect with someone else - by name (even a historical figure or public figure; MOJOMO hosts fictionalized AI personas of some, and you won't know which until you actually search), by topic, by specialism, or "find me someone who..." - always attempt the search rather than debating whether that person could plausibly be on the platform. Respond warmly and end your reply with exactly one fenced JSON block: \`\`\`json\n{"action": "find_match", "query": "<what they're looking for, in their words>"}\n\`\`\`
Only skip that block for ordinary conversation where they haven't asked you to go connect with anyone.`;

/** Reply in the private human<->own-avatar chat, detecting a "go find someone" intent. */
export async function generateAssistantReply(
  avatar: Avatar,
  history: Array<{ role: 'human' | 'avatar'; content: string }>
): Promise<AssistantReplyResult> {
  const system = avatarVoice(avatar) + ASSISTANT_SYSTEM_SUFFIX;
  const transcript = history
    .slice(-20)
    .map((m) => `${m.role === 'human' ? 'Them' : 'You'}: ${clip(m.content, 1000)}`)
    .join('\n');
  // Same reasoning as generateAvatarReply: surface the failure rather than storing filler.
  // avatarAssistant.handleHumanMessage lets this propagate so the route can return an error.
  const raw = await callModel(system, transcript || 'Say hello and ask a genuine getting-to-know-you question.');
  return extractAction(raw);
}

export default { generateAvatarReply, generateAssistantReply, extractAction, MAX_CONVERSATION_TURNS };
