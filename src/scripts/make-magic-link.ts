// Root-only CLI: print a sign-in link without email delivery (bootstrap / recovery).
// Usage: npm run auth:link -- someone@example.com
import * as dotenv from 'dotenv';
dotenv.config();
import { createMagicLink } from '../services/auth';
import { closePool } from '../services/db';

(async () => {
  const email = process.argv[2];
  if (!email) { console.error('usage: npm run auth:link -- <email>'); process.exit(2); }
  const link = await createMagicLink(email);
  console.log(`Sign-in link for ${link.email} (single use, expires ${link.expires_at.toISOString()}):\n${link.url}`);
  await closePool();
})().catch((e) => { console.error(e.message); process.exit(1); });
