import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDatabasePool, runMigrations, type DatabasePool } from '../../src/persistence/db.js';
import { UserRepository } from '../../src/persistence/repositories/user-repository.js';
import { IdentityRepository } from '../../src/persistence/repositories/identity-repository.js';
import { AllowlistRepository } from '../../src/persistence/repositories/allowlist-repository.js';
import { PreviewRepository } from '../../src/persistence/repositories/preview-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('PostgreSQL persistence', () => {
  let pool: DatabasePool;
  beforeAll(async () => {
    pool = createDatabasePool(databaseUrl!);
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await runMigrations(pool);
  });
  afterAll(async () => { await pool.end(); });

  test('migrations are idempotent and create expected schema', async () => {
    await runMigrations(pool);
    const result = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    const names = result.rows.map((r) => r.table_name);
    expect(names).toEqual(expect.arrayContaining(['users','external_identities','allowlist_entries','previews','schema_migrations']));
  });

  test('external provider+subject is unique', async () => {
    const users = new UserRepository(pool); const identities = new IdentityRepository(pool);
    const user = await users.create();
    await identities.create({ userId:user.id, provider:'github', providerSubject:'123', email:'a@example.test', emailVerified:true });
    await expect(identities.create({ userId:user.id, provider:'github', providerSubject:'123' })).rejects.toThrow();
  });

  test('allowlist matches email case-insensitively and provider scope', async () => {
    const repo = new AllowlistRepository(pool);
    await repo.add('Allowed@Example.Test', 'github');
    expect(await repo.isAllowed('allowed@example.test','github')).toBe(true);
    expect(await repo.isAllowed('allowed@example.test','google')).toBe(false);
  });

  test('preview repository enforces owner scope', async () => {
    const users = new UserRepository(pool); const previews = new PreviewRepository(pool);
    const owner = await users.create(); const other = await users.create();
    const created = await previews.create({
      id:'p-abcdefghijklmnop', ownerUserId:owner.id, hostname:'p-abcdefghijklmnop.preview.example',
      expiresAt:new Date(Date.now()+60_000), sourceType:'UPLOAD'
    });
    expect((await previews.findOwnedById(owner.id, created.id))?.id).toBe(created.id);
    expect(await previews.findOwnedById(other.id, created.id)).toBeNull();
    expect((await previews.listOwned(other.id)).map((p)=>p.id)).not.toContain(created.id);
  });

  test('cross-user lifecycle operations cannot mutate another owner preview', async () => {
    const users = new UserRepository(pool); const previews = new PreviewRepository(pool);
    const owner = await users.create(); const other = await users.create();
    const id='p-crossuser1234567890abcdef';
    const created = await previews.create({ id, ownerUserId:owner.id, hostname:`${id}.preview.example`, expiresAt:new Date(Date.now()+600_000), sourceType:'UPLOAD', status:'READY' });
    expect(await previews.markUpdatedOwned(other.id, id, {compressedSizeBytes:2,extractedSizeBytes:2,fileCount:2,sourceSha256:'a'.repeat(64),sourceType:'UPLOAD'})).toBeNull();
    expect(await previews.extendOwned(other.id, id, new Date(Date.now()+1_200_000))).toBeNull();
    expect(await previews.markDeletingOwned(other.id, id)).toBeNull();
    expect((await previews.findOwnedById(owner.id,id))?.status).toBe('READY');
    expect((await previews.findOwnedById(owner.id,id))?.expiresAt.getTime()).toBe(created.expiresAt.getTime());
  });

  test('preview lifecycle transitions require the expected source state', async () => {
    const users = new UserRepository(pool);
    const previews = new PreviewRepository(pool);
    const owner = await users.create();

    const creatingId='p-statecreating1234567890';
    await previews.create({
      id:creatingId,
      ownerUserId:owner.id,
      hostname:`${creatingId}.preview.example`,
      expiresAt:new Date(Date.now()+600_000),
      sourceType:'UPLOAD',
    });

    expect((await previews.markDeletingOwned(owner.id, creatingId))?.status).toBe('DELETING');
    expect(await previews.markReadyFromCreating(creatingId, {
      compressedSizeBytes:1,
      extractedSizeBytes:1,
      fileCount:1,
      sourceSha256:'b'.repeat(64),
    })).toBeNull();
    expect(await previews.markFailedFromCreating(creatingId, 'LATE_FAILURE')).toBe(false);
    expect((await previews.findOwnedById(owner.id, creatingId))?.status).toBe('DELETING');
    expect(await previews.markDeletedOwnedFromDeleting(owner.id, creatingId)).toBe(true);
    expect((await previews.findOwnedById(owner.id, creatingId))?.status).toBe('DELETED');

    const readyId='p-stateready1234567890abc';
    await previews.create({
      id:readyId,
      ownerUserId:owner.id,
      hostname:`${readyId}.preview.example`,
      expiresAt:new Date(Date.now()+600_000),
      sourceType:'UPLOAD',
      status:'READY',
    });
    expect(await previews.markFailedFromCreating(readyId, 'LATE_FAILURE')).toBe(false);
    expect((await previews.findOwnedById(owner.id, readyId))?.status).toBe('READY');
  });

});
