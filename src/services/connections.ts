// Orchestrates the OAuth dance and sync for external data connectors (Google Drive, OneDrive,
// ...). Everything this touches belongs to exactly one avatar and is deleted the moment that
// avatar disconnects or is deleted - this is the "closed data area" the product requires.
import { randomBytes } from 'crypto';
import * as db from './db';
import { encrypt, decrypt } from './crypto';
import { getConnector } from './connectors/registry';

const STATE_TTL_MIN = 15;

export async function startAuthorization(avatarId: string, provider: string): Promise<string> {
  const connector = getConnector(provider);
  if (!connector) throw new Error('Unknown provider');
  const state = randomBytes(24).toString('base64url');
  await db.query(
    `INSERT INTO mojomo.oauth_states (state, avatar_id, provider, expires_at) VALUES ($1, $2, $3, $4)`,
    [state, avatarId, provider, new Date(Date.now() + STATE_TTL_MIN * 60 * 1000)]
  );
  return connector.getAuthorizationUrl(state);
}

export async function handleCallback(provider: string, code: string, state: string): Promise<{ avatarId: string; connectionId: string }> {
  const connector = getConnector(provider);
  if (!connector) throw new Error('Unknown provider');

  const stateRes = await db.query(
    `UPDATE mojomo.oauth_states SET used_at = NOW()
     WHERE state = $1 AND provider = $2 AND used_at IS NULL AND expires_at > NOW() RETURNING avatar_id`,
    [state, provider]
  );
  if (stateRes.rows.length === 0) throw new Error('Invalid or expired authorization state');
  const avatarId: string = stateRes.rows[0].avatar_id;

  const tokens = await connector.exchangeCodeForTokens(code);
  const upserted = await db.query(
    `INSERT INTO mojomo.avatar_external_connections (avatar_id, provider, account_label, access_token_enc, refresh_token_enc, token_expires_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'connected')
     ON CONFLICT (avatar_id, provider) DO UPDATE SET
       account_label = EXCLUDED.account_label, access_token_enc = EXCLUDED.access_token_enc,
       refresh_token_enc = EXCLUDED.refresh_token_enc, token_expires_at = EXCLUDED.token_expires_at,
       status = 'connected', updated_at = NOW()
     RETURNING id`,
    [avatarId, provider, tokens.accountLabel, encrypt(tokens.accessToken), tokens.refreshToken ? encrypt(tokens.refreshToken) : null, tokens.expiresAt]
  );
  return { avatarId, connectionId: upserted.rows[0].id };
}

export async function listConnections(avatarId: string): Promise<any[]> {
  const r = await db.query(
    `SELECT provider, account_label, status, last_synced_at, created_at FROM mojomo.avatar_external_connections WHERE avatar_id = $1`,
    [avatarId]
  );
  return r.rows;
}

/**
 * Record a manually-uploaded data export (e.g. LinkedIn/Facebook/Instagram "download your data").
 * These platforms grant no API access for this use case (see project doc) - a user exporting
 * their OWN data via the platform's own official export tool and handing it to their avatar
 * sidesteps that entirely, legally cleanly. Modeled as a connection with no real OAuth tokens so
 * it shows up in the same connected-providers list and gets the same cascade-on-disconnect
 * cleanup; the sync scheduler already skips any provider with no registered Connector.
 */
export async function recordManualUpload(avatarId: string, provider: string, filename: string, content: string): Promise<void> {
  const conn = await db.query(
    `INSERT INTO mojomo.avatar_external_connections (avatar_id, provider, account_label, access_token_enc, token_expires_at, status)
     VALUES ($1, $2, 'Manually uploaded', $3, NOW(), 'connected')
     ON CONFLICT (avatar_id, provider) DO UPDATE SET status = 'connected', updated_at = NOW()
     RETURNING id`,
    [avatarId, provider, encrypt('manual-upload')]
  );
  const connectionId = conn.rows[0].id;
  await db.query(
    `INSERT INTO mojomo.avatar_external_documents (connection_id, avatar_id, external_id, title, snippet, source_type)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (connection_id, external_id) DO UPDATE SET title = EXCLUDED.title, snippet = EXCLUDED.snippet, fetched_at = NOW()`,
    [connectionId, avatarId, filename.slice(0, 200), encrypt(filename.slice(0, 500)), encrypt(content.slice(0, 8000)), `manual_upload:${provider}`]
  );
}

export async function disconnect(avatarId: string, provider: string): Promise<void> {
  // Cascades to avatar_external_documents via FK - the whole point is nothing lingers once disconnected.
  await db.query(`DELETE FROM mojomo.avatar_external_connections WHERE avatar_id = $1 AND provider = $2`, [avatarId, provider]);
}

/** Sync one connection: refresh the token if needed, fetch a fresh inventory, replace stored documents. */
export async function syncConnection(connectionId: string): Promise<void> {
  const connRes = await db.query(`SELECT * FROM mojomo.avatar_external_connections WHERE id = $1`, [connectionId]);
  if (connRes.rows.length === 0) return;
  const conn = connRes.rows[0];
  const connector = getConnector(conn.provider);
  if (!connector) return;

  try {
    let accessToken = decrypt(conn.access_token_enc);
    if (new Date(conn.token_expires_at) <= new Date(Date.now() + 60_000)) {
      if (!conn.refresh_token_enc) throw new Error('Token expired and no refresh token available');
      const refreshed = await connector.refreshAccessToken(decrypt(conn.refresh_token_enc));
      accessToken = refreshed.accessToken;
      await db.query(
        `UPDATE mojomo.avatar_external_connections SET access_token_enc = $1, refresh_token_enc = $2, token_expires_at = $3, updated_at = NOW() WHERE id = $4`,
        [encrypt(refreshed.accessToken), refreshed.refreshToken ? encrypt(refreshed.refreshToken) : conn.refresh_token_enc, refreshed.expiresAt, connectionId]
      );
    }

    const documents = await connector.fetchProfileData(accessToken);
    await db.withTransaction(async (client) => {
      await client.query(`DELETE FROM mojomo.avatar_external_documents WHERE connection_id = $1`, [connectionId]);
      for (const doc of documents) {
        await client.query(
          `INSERT INTO mojomo.avatar_external_documents (connection_id, avatar_id, external_id, title, snippet, source_type)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (connection_id, external_id) DO NOTHING`,
          [connectionId, conn.avatar_id, doc.externalId, encrypt(doc.title.slice(0, 500)), encrypt(doc.snippet.slice(0, 1000)), doc.sourceType]
        );
      }
    });
    await db.query(`UPDATE mojomo.avatar_external_connections SET status = 'connected', last_synced_at = NOW() WHERE id = $1`, [connectionId]);
  } catch (err: any) {
    console.error(`Sync failed for connection ${connectionId}:`, err.message);
    await db.query(`UPDATE mojomo.avatar_external_connections SET status = 'error', updated_at = NOW() WHERE id = $1`, [connectionId]);
  }
}

let syncTimer: ReturnType<typeof setInterval> | null = null;

/** Periodically re-sync every connected account, so profiles stay current without manual action. */
export function startConnectionSyncScheduler(
  intervalMs: number = Number(process.env.CONNECTION_SYNC_INTERVAL_MS || 24 * 60 * 60 * 1000)
): void {
  if (syncTimer) return;
  const run = async () => {
    try {
      const rows = await db.query(`SELECT id FROM mojomo.avatar_external_connections WHERE status != 'revoked'`);
      for (const { id } of rows.rows) await syncConnection(id).catch((e) => console.error(`Scheduled sync failed for ${id}:`, e));
      if (rows.rows.length > 0) console.log(`Connection sync sweep: refreshed ${rows.rows.length} connection(s)`);
    } catch (e) {
      console.error('Connection sync sweep failed:', e);
    }
  };
  syncTimer = setInterval(run, intervalMs);
  console.log(`External connection sync scheduler: every ${Math.round(intervalMs / 3600000)}h`);
}

export function stopConnectionSyncScheduler(): void {
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
}

export default { startAuthorization, handleCallback, listConnections, disconnect, syncConnection, recordManualUpload, startConnectionSyncScheduler, stopConnectionSyncScheduler };
