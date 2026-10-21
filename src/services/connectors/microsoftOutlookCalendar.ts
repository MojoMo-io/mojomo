// Outlook Calendar connector via Microsoft Graph. Calendars.Read already returns bodyPreview
// (Graph's own short plain-text extract of the event body), so like the Google Calendar
// connector this needs no broader scope to get content. Attendee lists are still only ever
// persisted as an aggregate frequency count, never a per-event attendee list.
import axios from 'axios';
import { createMicrosoftConnector } from './microsoftOAuth';
import { ExternalDocument } from './types';

async function fetchProfileData(accessToken: string): Promise<ExternalDocument[]> {
  const now = Date.now();
  const startDateTime = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const endDateTime = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
  const r = await axios.get('https://graph.microsoft.com/v1.0/me/calendarview', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { startDateTime, endDateTime, $top: 50, $select: 'subject,start,attendees,bodyPreview', $orderby: 'start/dateTime' },
  });
  const events = r.data.value || [];

  const eventDocs: ExternalDocument[] = [];
  const attendeeCounts: Record<string, number> = {};
  for (const e of events) {
    const body = e.bodyPreview ? String(e.bodyPreview).slice(0, 600) : '';
    eventDocs.push({
      externalId: e.id,
      title: e.subject || '(untitled event)',
      snippet: `meeting on ${e.start?.dateTime || ''}${e.attendees ? `, ${e.attendees.length} attendee(s)` : ''}${body ? ` - ${body}` : ''}`,
      sourceType: 'outlook_calendar_event',
    });
    for (const a of e.attendees || []) {
      const email = a.emailAddress?.address;
      if (!email) continue;
      attendeeCounts[email] = (attendeeCounts[email] || 0) + 1;
    }
  }

  const attendeeDocs = Object.entries(attendeeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([email, count]) => ({
      externalId: `attendee:${email}`,
      title: email,
      snippet: `co-attended ${count} meeting(s) recently`,
      sourceType: 'outlook_calendar_frequent_attendee',
    }));

  return [...eventDocs.slice(0, 30), ...attendeeDocs];
}

export const microsoftOutlookCalendarConnector = createMicrosoftConnector(
  'microsoft_outlook_calendar',
  'offline_access User.Read Calendars.Read',
  fetchProfileData
);

export default microsoftOutlookCalendarConnector;
