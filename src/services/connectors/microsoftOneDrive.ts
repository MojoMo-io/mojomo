// Microsoft OneDrive connector via Microsoft Graph. Microsoft Graph has no delegated scope as
// narrow as Google's "metadata only," so the granted scope (Files.Read) technically permits
// reading file content - but this connector deliberately only ever calls the metadata-listing
// endpoint (/me/drive/root/children), never a file's /content, matching the same
// metadata-only-inventory design as the Google Drive connector.
import axios from 'axios';
import { createMicrosoftConnector } from './microsoftOAuth';
import { ExternalDocument } from './types';

async function fetchProfileData(accessToken: string): Promise<ExternalDocument[]> {
  const r = await axios.get('https://graph.microsoft.com/v1.0/me/drive/root/children', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { $top: 50, $orderby: 'lastModifiedDateTime desc', $select: 'id,name,file,folder,lastModifiedDateTime' },
  });
  return (r.data.value || []).map((f: any) => ({
    externalId: f.id,
    title: f.name,
    snippet: `${f.folder ? 'folder' : (f.file?.mimeType || 'file')}, last modified ${f.lastModifiedDateTime}`,
    sourceType: 'onedrive_item',
  }));
}

export const microsoftOneDriveConnector = createMicrosoftConnector(
  'microsoft_onedrive',
  'offline_access User.Read Files.Read',
  fetchProfileData
);

export default microsoftOneDriveConnector;
