import { loadConfig } from '../config.js';
import { createDatabasePool, runMigrations } from './db.js';

const config = loadConfig();
const pool = createDatabasePool(config.databaseUrl);
try {
  await runMigrations(pool);
  console.log('Database migrations applied');
} finally {
  await pool.end();
}
