import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
export type DatabaseExecutor = {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
};
export type DatabasePool = pg.Pool;

export function createDatabasePool(databaseUrl: string): DatabasePool {
  return new Pool({ connectionString: databaseUrl });
}

export async function assertDatabaseReady(pool: DatabasePool): Promise<void> {
  await pool.query('SELECT 1');
}

export async function runMigrations(pool: DatabasePool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
  const filenames = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();

  for (const filename of filenames) {
    const exists = await pool.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = $1) AS exists',
      [filename],
    );
    if (exists.rows[0]?.exists) continue;

    const sql = await readFile(join(migrationsDir, filename), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [filename]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
