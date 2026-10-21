// Google Calendar connector. calendar.readonly already returns each event's description, so
// unlike the mail connectors this needs no broader scope to get content - just using a field
// this scope always included. Attendee lists are still only ever persisted as an aggregate
// frequency count, never a per-event attendee list, to limit how much of anyone else's identity
// this app holds.
import axios from 'axios';
import { createGoogleConnector } from './googleOAuth';
import { ExternalDocument } from './types';

async function fetchProfileData(accessToken: string): Promise<ExternalDocument[]> {
  const now = Date.now();
  const timeMin = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
  const r = await axios.get('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { timeMin, timeMax, maxResults: 50, singleEvents: true, orderBy: 'startTime' },
  });
  const events = r.data.items || [];

  const eventDocs: ExternalDocument[] = [];
  const attendeeCounts: Record<string, number> = {};
  for (const e of events) {
    const start = e.start?.dateTime || e.start?.date || '';
    const description = (e.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
    eventDocs.push({
      externalId: e.id,
      title: e.summary || '(untitled event)',
      snippet: `meeting on ${start}${e.attendees ? `, ${e.attendees.length} attendee(s)` : ''}${description ? ` - ${description}` : ''}`,
      sourceType: 'google_calendar_event',
    });
    for (const a of e.attendees || []) {
      if (!a.email || a.self) continue;
      attendeeCounts[a.email] = (attendeeCounts[a.email] || 0) + 1;
    }
  }

  const attendeeDocs = Object.entries(attendeeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([email, count]) => ({
      externalId: `attendee:${email}`,
      title: email,
      snippet: `co-attended ${count} meeting(s) recently`,
      sourceType: 'google_calendar_frequent_attendee',
    }));

  return [...eventDocs.slice(0, 30), ...attendeeDocs];
}

export const googleCalendarConnector = createGoogleConnector(
  'google_calendar',
  'openid email https://www.googleapis.com/auth/calendar.readonly',
  fetchProfileData
);

export default googleCalendarConnector;
