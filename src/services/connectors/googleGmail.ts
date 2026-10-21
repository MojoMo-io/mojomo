// Gmail connector. Scope is gmail.readonly (not gmail.metadata) so body content is actually
// available - needed to infer projects/skills/interests from what someone actually writes about,
// not just who they write to. Google classifies gmail.readonly as a "restricted" scope requiring
// their CASA security review before serving the general public; while this app stays in OAuth
// "Testing" mode with a small, explicitly-added user list (its current state), that review isn't
// required at all - only relevant if/when this ever needs public availability.
// Still capped: ~20 recent messages, ~900 chars of body text each, plus the same aggregate
// per-correspondent frequency count as before. No attachments are ever fetched or read.
import axios from 'axios';
import { createGoogleConnector } from './googleOAuth';
import { ExternalDocument } from './types';

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

/** Walk a Gmail message payload for the first text/plain part; fall back to a crude HTML strip. */
function extractBodyText(payload: any): string {
  if (!payload) return '';
  const stack = [payload];
  let htmlFallback = '';
  while (stack.length) {
    const part = stack.shift();
    if (part.mimeType === 'text/plain' && part.body?.data) return decodeBase64Url(part.body.data);
    if (part.mimeType === 'text/html' && part.body?.data && !htmlFallback) htmlFallback = decodeBase64Url(part.body.data);
    if (part.parts) stack.push(...part.parts);
  }
  return htmlFallback.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function headerValue(headers: any[], name: string): string {
  return headers.find((h: any) => h.name === name)?.value || '';
}

async function fetchProfileData(accessToken: string): Promise<ExternalDocument[]> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const list = await axios.get('https://gmail.googleapis.com/gmail/v1/users/me/messages', {
    headers, params: { maxResults: 20 },
  });
  const ids: string[] = (list.data.messages || []).map((m: any) => m.id);

  const contactCounts: Record<string, number> = {};
  const messageDocs: ExternalDocument[] = [];
  const results = await Promise.allSettled(
    ids.map((id) => axios.get(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`, { headers, params: { format: 'full' } }))
  );
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const msg = r.value.data;
    const msgHeaders = msg.payload?.headers || [];
    for (const name of ['From', 'To']) {
      for (const addr of headerValue(msgHeaders, name).split(',')) {
        const trimmed = addr.trim();
        if (trimmed) contactCounts[trimmed] = (contactCounts[trimmed] || 0) + 1;
      }
    }
    const subject = headerValue(msgHeaders, 'Subject') || '(no subject)';
    const body = extractBodyText(msg.payload).slice(0, 900);
    if (body) messageDocs.push({ externalId: msg.id, title: subject, snippet: body, sourceType: 'gmail_message' });
  }

  const contactDocs = Object.entries(contactCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([contact, count]) => ({
      externalId: `contact:${contact}`,
      title: contact,
      snippet: `exchanged messages ${count} time(s) recently`,
      sourceType: 'gmail_frequent_contact',
    }));

  return [...messageDocs, ...contactDocs];
}

export const googleGmailConnector = createGoogleConnector(
  'google_gmail',
  'openid email https://www.googleapis.com/auth/gmail.readonly',
  fetchProfileData
);

export default googleGmailConnector;
