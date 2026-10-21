// Add a new source by implementing Connector (types.ts) and registering it here - nothing else
// in the app needs to change. LinkedIn/Facebook are not registered: both require formal
// platform partner approval this project doesn't have (see MOJOMO-PROJECT-OVERVIEW.txt) - use
// the manual data-export upload path (services/connections.ts recordManualUpload) instead.
import { Connector } from './types';
import googleDriveConnector from './googleDrive';
import googleGmailConnector from './googleGmail';
import googleCalendarConnector from './googleCalendar';
import microsoftOneDriveConnector from './microsoftOneDrive';
import microsoftOutlookMailConnector from './microsoftOutlookMail';
import microsoftOutlookCalendarConnector from './microsoftOutlookCalendar';

const registry: Record<string, Connector> = {
  google_drive: googleDriveConnector,
  google_gmail: googleGmailConnector,
  google_calendar: googleCalendarConnector,
  microsoft_onedrive: microsoftOneDriveConnector,
  microsoft_outlook_mail: microsoftOutlookMailConnector,
  microsoft_outlook_calendar: microsoftOutlookCalendarConnector,
};

export function getConnector(provider: string): Connector | null {
  return registry[provider] || null;
}

export function listProviders(): string[] {
  return Object.keys(registry);
}

export default { getConnector, listProviders };
