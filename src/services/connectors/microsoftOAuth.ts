// Shared OAuth plumbing for every Microsoft-flavored connector (OneDrive, Outlook Mail,
// Outlook Calendar, ...). Same one-factory-per-family pattern as googleOAuth.ts.
import axios from 'axios';
import { Connector, TokenSet, ExternalDocument } from './types';

const CLIENT_ID = process.env.MS_CLIENT_ID;
const CLIENT_SECRET = process.env.MS_CLIENT_SECRET;

function requireCredentials() {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('Microsoft connector is not configured (MS_CLIENT_ID/MS_CLIENT_SECRET missing)');
}

async function fetchAccountLabel(accessToken: string): Promise<string> {
  const r = await axios.get('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${accessToken}` } });
  return r.data.mail || r.data.userPrincipalName || 'connected Microsoft account';
}

function redirectUriFor(provider: string): string {
  return `${(process.env.PUBLIC_URL || 'https://mojomo.io').replace(/\/$/, '')}/api/connections/${provider}/callback`;
}

export function createMicrosoftConnector(
  provider: string,
  scope: string,
  fetchProfileData: (accessToken: string) => Promise<ExternalDocument[]>
): Connector {
  const redirectUri = redirectUriFor(provider);
  return {
    provider,
    getAuthorizationUrl(state: string): string {
      requireCredentials();
      const params = new URLSearchParams({ client_id: CLIENT_ID!, response_type: 'code', redirect_uri: redirectUri, response_mode: 'query', scope, state });
      return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
    },
    async exchangeCodeForTokens(code: string): Promise<TokenSet> {
      requireCredentials();
      const r = await axios.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', new URLSearchParams({
        code, client_id: CLIENT_ID!, client_secret: CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: 'authorization_code', scope,
      }));
      const accountLabel = await fetchAccountLabel(r.data.access_token).catch(() => 'connected Microsoft account');
      return { accessToken: r.data.access_token, refreshToken: r.data.refresh_token || null, expiresAt: new Date(Date.now() + r.data.expires_in * 1000), accountLabel };
    },
    async refreshAccessToken(refreshToken: string): Promise<TokenSet> {
      requireCredentials();
      const r = await axios.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', new URLSearchParams({
        refresh_token: refreshToken, client_id: CLIENT_ID!, client_secret: CLIENT_SECRET!, grant_type: 'refresh_token', scope,
      }));
      const accountLabel = await fetchAccountLabel(r.data.access_token).catch(() => 'connected Microsoft account');
      return { accessToken: r.data.access_token, refreshToken: r.data.refresh_token || refreshToken, expiresAt: new Date(Date.now() + r.data.expires_in * 1000), accountLabel };
    },
    fetchProfileData,
  };
}

export default { createMicrosoftConnector };
