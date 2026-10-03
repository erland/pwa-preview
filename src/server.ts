import { buildApp } from './app.js';
import { loadConfig, safeConfigSummary } from './config.js';
import { createDatabasePool, runMigrations } from './persistence/db.js';
import { PreviewRepository } from './persistence/repositories/preview-repository.js';
import { LocalVolumeObjectStore } from './storage/local-volume-object-store.js';
import { CleanupJob } from './preview/cleanup-job.js';
import { ReconciliationJob } from './preview/reconciliation-job.js';

const port = Number(process.env.PORT ?? '3000');
const host = process.env.HOST ?? '0.0.0.0';

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid application configuration');
  process.exit(1);
}

const pool = createDatabasePool(config.databaseUrl);
if (config.migrateOnStart) await runMigrations(pool);

const store = new LocalVolumeObjectStore(config.dataRoot);
await store.initialize();
const app = buildApp({ config, pool });
const repository = new PreviewRepository(pool);
const cleanupJob = new CleanupJob(repository, store);
const reconciliationJob = new ReconciliationJob(repository, store);

const runCleanup = () => cleanupJob.runOnce().catch((error) => app.log.error(error, 'cleanup failed'));
const runReconciliation = () => reconciliationJob.runOnce({
  staleCreatingBefore: new Date(Date.now() - config.staleOperationMinutes * 60_000),
  staleStagingBefore: new Date(Date.now() - config.staleStagingMinutes * 60_000),
}).catch((error) => app.log.error(error, 'reconciliation failed'));
await runCleanup();
await runReconciliation();
const cleanupTimer = setInterval(runCleanup, config.cleanupIntervalMs); cleanupTimer.unref();
const reconciliationTimer = setInterval(runReconciliation, config.reconciliationIntervalMs); reconciliationTimer.unref();
app.log.info({ config: safeConfigSummary(config) }, 'configuration loaded');

app.addHook('onClose', async () => {
  clearInterval(cleanupTimer);
  clearInterval(reconciliationTimer);
  await pool.end();
});

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'graceful shutdown started');
  const force = setTimeout(() => process.exit(1), 15_000); force.unref();
  try {
    await app.close();
    clearTimeout(force);
    process.exit(0);
  } catch (error) {
    app.log.error(error, 'graceful shutdown failed');
    process.exit(1);
  }
}
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  await pool.end().catch(() => undefined);
  process.exit(1);
}
