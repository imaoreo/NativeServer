import pg from 'pg';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://grind_user:secure_password123@localhost:5432/grind_db?sslmode=disable'
});

export async function runMigrations(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS goose_db_version (
      id SERIAL PRIMARY KEY,
      version_id BIGINT NOT NULL,
      is_applied BOOLEAN NOT NULL,
      tstamp TIMESTAMP DEFAULT NOW()
    )
  `);

  const migrationsDir = './db/migrations';
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const versionId = parseInt(file.split('_')[0], 10);
    
    const result = await pool.query(
      'SELECT 1 FROM goose_db_version WHERE version_id = $1 AND is_applied = TRUE',
      [versionId]
    );

    if (result.rows.length > 0) continue;

    console.log(`Running database migration: ${file}`);
    const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

    // Extract Up section
    const lines = content.split('\n');
    let upSqlLines: string[] = [];
    let capture = false;

    for (const line of lines) {
      if (line.includes('+goose Up')) {
        capture = true;
        continue;
      }
      if (line.includes('+goose Down')) {
        capture = false;
        break;
      }
      if (capture) {
        if (!line.includes('+goose StatementBegin') && !line.includes('+goose StatementEnd')) {
          upSqlLines.push(line);
        }
      }
    }

    const sql = upSqlLines.join('\n').trim();
    if (sql) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO goose_db_version (version_id, is_applied) VALUES ($1, TRUE)',
          [versionId]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Migration ${file} failed:`, err);
        throw err;
      } finally {
        client.release();
      }
    }
  }
}

export async function saveDeviceKey(keyId: string, publicKeyPEM: string): Promise<void> {
  const deviceId = uuidv4();
  await pool.query(
    `INSERT INTO "DeviceKey" ("id", "keyId", "publicKey", "counter", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [deviceId, keyId, publicKeyPEM]
  );
}

export async function getDeviceKey(keyId: string): Promise<string> {
  const result = await pool.query(
    `SELECT "publicKey" FROM "DeviceKey" WHERE "keyId" = $1`,
    [keyId]
  );
  if (result.rows.length === 0) {
    throw new Error('Device key not registered');
  }
  return result.rows[0].publicKey;
}

export async function getCompanionDeviceCountByDeviceKey(deviceKeyId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*) FROM "CompanionDevice" WHERE "deviceKeyId" = $1 AND "isOverride" = FALSE`,
    [deviceKeyId]
  );
  return parseInt(result.rows[0].count, 10);
}

export async function getCompanionDeviceCountByDiscordId(discordId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*) FROM "CompanionDevice" WHERE "discordId" = $1 AND "isOverride" = FALSE`,
    [discordId]
  );
  return parseInt(result.rows[0].count, 10);
}

export async function saveCompanionDevice(
  deviceKeyId: string,
  discordId: string,
  apiKey: string,
  source: string,
  isOverride: boolean = false
): Promise<void> {
  const id = uuidv4();
  const dkID = deviceKeyId || null;
  const dID = discordId || null;
  const aKey = apiKey || null;

  await pool.query(
    `INSERT INTO "CompanionDevice" ("id", "deviceKeyId", "discordId", "apiKey", "registrationSource", "isOverride", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [id, dkID, dID, aKey, source, isOverride]
  );
}

export async function validateCompanionApiKey(apiKey: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM "CompanionDevice" WHERE "apiKey" = $1) as exists`,
    [apiKey]
  );
  return result.rows[0].exists;
}
