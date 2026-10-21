// Shared OAuth plumbing for every Google-flavored connector (Drive, Gmail, Calendar, ...). Each
// connector is just this factory + its own scope + its own fetchProfileData - adding a fourth
// Google data source later means writing one small function, not another full OAuth client.
import axios from 'axios';
import { Connector, TokenSet, ExternalDocument } from './types';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

function requireCredentials() {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('Google connector is not configured (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET missing)');
}

async function fetchAccountEmail(accessToken: string): Promise<string> {
  const r = await axios.get('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
  return r.data.email || 'connected Google account';
}

function redirectUriFor(provider: string): string {
  return `${(process.env.PUBLIC_URL || 'https://mojomo.io').replace(/\/$/, '')}/api/connections/${provider}/callback`;
}

export function createGoogleConnector(
  provider: string,
  scope: string,
  fetchProfileData: (accessToken: string) => Promise<ExternalDocument[]>
): Connector {
  const redirectUri = redirectUriFor(provider);
  return {
    provider,
    getAuthorizationUrl(state: string): string {
      requireCredentials();
      const params = new URLSearchParams({
        client_id: CLIENT_ID!, redirect_uri: redirectUri, response_type: 'code',
        scope, access_type: 'offline', prompt: 'consent', state,
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    },
    async exchangeCodeForTokens(code: string): Promise<TokenSet> {
      requireCredentials();
      const r = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
        code, client_id: CLIENT_ID!, client_secret: CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: 'authorization_code',
      }));
      const accountLabel = await fetchAccountEmail(r.data.access_token).catch(() => 'connected Google account');
      return { accessToken: r.data.access_token, refreshToken: r.data.refresh_token || null, expiresAt: new Date(Date.now() + r.data.expires_in * 1000), accountLabel };
    },
    async refreshAccessToken(refreshToken: string): Promise<TokenSet> {
      requireCredentials();
      const r = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
        refresh_token: refreshToken, client_id: CLIENT_ID!, client_secret: CLIENT_SECRET!, grant_type: 'refresh_token',
      }));
      const accountLabel = await fetchAccountEmail(r.data.access_token).catch(() => 'connected Google account');
      return { accessToken: r.data.access_token, refreshToken, expiresAt: new Date(Date.now() + r.data.expires_in * 1000), accountLabel };
    },
    fetchProfileData,
  };
}

export default { createGoogleConnector };
