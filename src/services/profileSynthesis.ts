// Builds/refreshes an avatar's personality_profile from its private chat history with its human.
// Same tolerant-JSON-parsing approach as reasoning.ts's parseReasoningJson.
import * as db from './db';
import { complete } from './llm';
import { decrypt } from './crypto';
import { PersonalityProfile } from '../types';


const SYSTEM = `You build personality profiles for MOJOMO avatars from a transcript of a private chat between a person and their AI avatar, plus (optionally) data from their connected accounts: file names/types from Google Drive/OneDrive; email subject lines and body excerpts from Gmail/Outlook plus an aggregate count of who they exchange messages with most; meeting titles and description excerpts from Google/Outlook Calendar plus an aggregate count of who they meet with most; and/or manually-uploaded data-export files (LinkedIn/Facebook/Instagram). This is real personal content - use it to genuinely understand their projects, skills, and interests. Respond in valid JSON only, matching exactly:
{"interests": ["..."], "specialisms": ["..."], "values": ["..."], "communication_style": "one sentence", "summary": "one paragraph, written as instructions to an AI that will speak AS this person's avatar to other avatars - cover personality, interests, specialisms, and how they communicate"}
If the input is too thin to know much yet, make a light, honest, low-confidence profile rather than inventing detail.

CRITICAL PRIVACY RULE: the "summary" field is the ONLY field ever shown to other people's avatars (for matchmaking) - everything else you produce stays private to this one avatar. "summary" must stay general - personality, interests, specialisms, communication style. NEVER put a specific file/email/meeting title, quoted or paraphrased email/meeting body text, email address, other real person's name, employer/client name, or any other identifying detail from the connected-account data into "summary" - translate it into general traits instead (e.g. a project name becomes "works on technical infrastructure projects", not the project's actual name; frequent contacts become "collaborates closely with a small circle of colleagues", never names or addresses).`;

export async function synthesizePersonalityProfile(avatarId: string): Promise<PersonalityProfile | null> {
  const [msgsRes, docsRes] = await Promise.all([
    db.query(`SELECT role, content FROM mojomo.avatar_direct_messages WHERE avatar_id = $1 ORDER BY created_at ASC LIMIT 200`, [avatarId]),
    db.query(`SELECT title, snippet, source_type FROM mojomo.avatar_external_documents WHERE avatar_id = $1 ORDER BY fetched_at DESC LIMIT 50`, [avatarId]),
  ]);
  if (msgsRes.rows.length === 0 && docsRes.rows.length === 0) return null;

  const transcript = msgsRes.rows
    .map((m: any) => `${m.role === 'human' ? 'Person' : 'Avatar'}: ${String(m.content).slice(0, 1000)}`)
    .join('\n');
  const docInventory = docsRes.rows
    .map((d: any) => `- [${d.source_type}] ${decrypt(d.title)} (${decrypt(d.snippet)})`)
    .join('\n');

  try {
    const result = await complete({
      system: SYSTEM,
      user: `Transcript:\n${transcript || '(no chat yet)'}${docInventory ? `\n\nConnected-account data:\n${docInventory}` : ''}`,
      maxTokens: 768,
      json: true,
    });
    let t = result.text.trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    const parsed = JSON.parse(t.slice(start, end + 1));
    const profile: PersonalityProfile = {
      interests: Array.isArray(parsed.interests) ? parsed.interests.slice(0, 20) : [],
      specialisms: Array.isArray(parsed.specialisms) ? parsed.specialisms.slice(0, 20) : [],
      values: Array.isArray(parsed.values) ? parsed.values.slice(0, 20) : [],
      communication_style: String(parsed.communication_style || ''),
      summary: String(parsed.summary || ''),
    };
    await db.query(`UPDATE mojomo.avatars SET personality_profile = $1, updated_at = NOW() WHERE id = $2`, [
      JSON.stringify(profile),
      avatarId,
    ]);
    return profile;
  } catch (err) {
    console.error(`synthesizePersonalityProfile failed for avatar ${avatarId}:`, err);
    return null;
  }
}

export default { synthesizePersonalityProfile };
