// Google Drive connector. Deliberately metadata-only (drive.metadata.readonly, not drive.readonly)
// - file names, types, and modified dates, never file contents. That's enough to inform a
// personality profile (what someone works on, their interests) while minimizing how much raw
// personal data this app ever holds, and it's a lighter scope for Google's app-verification review.
import axios from 'axios';
import { createGoogleConnector } from './googleOAuth';
import { ExternalDocument } from './types';

async function fetchProfileData(accessToken: string): Promise<ExternalDocument[]> {
  const r = await axios.get('https://www.googleapis.com/drive/v3/files', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { pageSize: 50, orderBy: 'modifiedTime desc', fields: 'files(id,name,mimeType,modifiedTime)' },
  });
  return (r.data.files || []).map((f: any) => ({
    externalId: f.id,
    title: f.name,
    snippet: `${f.mimeType.replace('application/vnd.google-apps.', '')}, last modified ${f.modifiedTime}`,
    sourceType: 'google_drive_file',
  }));
}

export const googleDriveConnector = createGoogleConnector(
  'google_drive',
  'openid email https://www.googleapis.com/auth/drive.metadata.readonly',
  fetchProfileData
);

export default googleDriveConnector;
