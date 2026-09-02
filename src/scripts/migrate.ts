// Database migration script
import * as fs from 'fs';
import * as path from 'path';
import { getClient } from '../services/db';

async function runMigrations() {
  const client = await getClient();

  try {
    console.log('Starting database migrations...');

    // Read and execute schema.sql
    const schemaPath = path.join(__dirname, '../../schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');

    console.log('Executing schema...');
    await client.query(schemaSql);

    console.log('✅ Database migrations completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
  }
}

runMigrations();
