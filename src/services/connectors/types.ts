// A Connector is one external data source (Google Drive, OneDrive, and eventually LinkedIn,
// Facebook, etc. once/if their platforms grant real API access - see project doc). Adding a new
// source means implementing this interface and registering it in registry.ts; nothing else in
// the app needs to change.
export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  accountLabel: string; // e.g. the connected account's email, shown to the user
}

export interface ExternalDocument {
  externalId: string; // provider's own id for this item, for dedup/update-in-place
  title: string;
  snippet: string; // capped extracted text - never the full raw document
  sourceType: string;
}

export interface Connector {
  provider: string;
  /** Where to send the user to consent. `state` is an opaque one-time token, not app data. */
  getAuthorizationUrl(state: string): string;
  exchangeCodeForTokens(code: string): Promise<TokenSet>;
  refreshAccessToken(refreshToken: string): Promise<TokenSet>;
  /** A light inventory, not a full data dump - capped list of documents/items with short snippets. */
  fetchProfileData(accessToken: string): Promise<ExternalDocument[]>;
}
