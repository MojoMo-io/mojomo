// Outlook Mail connector via Microsoft Graph. Scope is Mail.Read (not Mail.ReadBasic) so body
// content is actually available - needed to infer projects/skills/interests from what someone
// writes about, not just who they write to. Unlike Google's gmail.readonly, Microsoft doesn't
// gate Mail.Read behind a special public-review tier - a signed-in user's own delegated consent
// is sufficient regardless of app review status.
// Capped: ~20 recent messages, using Graph's own bodyPreview (a short plain-text extract Graph
// generates itself, already stripped of HTML - no attachment content is ever fetched), plus the
// same aggregate per-correspondent frequency count as before.
import axios from 'axios';
import { createMicrosoftConnector } from './microsoftOAuth';
import { ExternalDocument } from './types';

async function fetchProfileData(accessToken: string): Promise<ExternalDocument[]> {
  const r = await axios.get('https://graph.microsoft.com/v1.0/me/messages', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { $top: 20, $select: 'from,toRecipients,subject,bodyPreview,receivedDateTime', $orderby: 'receivedDateTime desc' },
  });

  const contactCounts: Record<string, number> = {};
  const messageDocs: ExternalDocument[] = [];
  for (const m of r.data.value || []) {
    const addrs: string[] = [];
    if (m.from?.emailAddress?.address) addrs.push(m.from.emailAddress.address);
    for (const t of m.toRecipients || []) if (t.emailAddress?.address) addrs.push(t.emailAddress.address);
    for (const a of addrs) contactCounts[a] = (contactCounts[a] || 0) + 1;

    if (m.bodyPreview) {
      messageDocs.push({
        externalId: m.id,
        title: m.subject || '(no subject)',
        snippet: String(m.bodyPreview).slice(0, 900),
        sourceType: 'outlook_message',
      });
    }
  }

  const contactDocs = Object.entries(contactCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([contact, count]) => ({
      externalId: `contact:${contact}`,
      title: contact,
      snippet: `exchanged messages ${count} time(s) recently`,
      sourceType: 'outlook_frequent_contact',
    }));

  return [...messageDocs, ...contactDocs];
}

export const microsoftOutlookMailConnector = createMicrosoftConnector(
  'microsoft_outlook_mail',
  'offline_access User.Read Mail.Read',
  fetchProfileData
);

export default microsoftOutlookMailConnector;
