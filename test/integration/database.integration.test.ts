import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { UserService } from '../../src/users/user-service.js';

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

  test('GitHub allowlist sync is authoritative only for GitHub-scoped entries', async () => {
    const repo = new AllowlistRepository(pool);
    await repo.add('old@example.test', 'github');
    await repo.add('neutral@example.test', null);

    await repo.syncGitHub(['Allowed@Example.Test', 'second@example.test']);
    await repo.syncGitHub(['allowed@example.test', 'second@example.test']);

    expect(await repo.isAllowed('allowed@example.test', 'github')).toBe(true);
    expect(await repo.isAllowed('second@example.test', 'github')).toBe(true);
    expect(await repo.isAllowed('old@example.test', 'github')).toBe(false);
    expect(await repo.isAllowed('neutral@example.test', 'github')).toBe(true);

    const githubRows = await pool.query<{ email: string; enabled: boolean }>(
      "SELECT email, enabled FROM allowlist_entries WHERE provider = 'github' ORDER BY lower(email)",
    );
    expect(githubRows.rows).toEqual([
      { email: 'allowed@example.test', enabled: true },
      { email: 'old@example.test', enabled: false },
      { email: 'second@example.test', enabled: true },
    ]);
  });

  test('empty GitHub allowlist sync is a no-op', async () => {
    const repo = new AllowlistRepository(pool);
    await repo.add('keep@example.test', 'github');
    await repo.syncGitHub([]);
    expect(await repo.isAllowed('keep@example.test', 'github')).toBe(true);
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
    expect((await previews.findOwnedById(owner.id,id))?.expiresAt?.getTime()).toBe(created.expiresAt?.getTime());
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

  test('permanent preview survives expiration', async () => {
    const owner = await new UserRepository(pool).create();
    const repository = new PreviewRepository(pool);
    const id = 'p-' + 'f'.repeat(32);
    await repository.create({id, ownerUserId:owner.id, hostname:id+'.preview.example', expiresAt:new Date(Date.now()+600000), sourceType:'UPLOAD', status:'READY'});
    const p = await repository.promoteOwned(owner.id,id,'example-test');
    expect(p?.publicationMode).toBe('PERMANENT');
    expect((await repository.findReadyBySlug('example-test'))?.id).toBe(id);
    expect((await repository.claimExpired(100)).some(x=>x.id===id)).toBe(false);
  });

  test('simultaneous promotions cannot exceed the permanent quota', async () => {
    const user = await new UserRepository(pool).create();
    const repository = new PreviewRepository(pool);
    const prefix = 'p-quota';
    for (let index = 0; index < 11; index++) {
      const id = prefix + String(index).padStart(16, '0');
      await repository.create({
        id, ownerUserId: user.id, hostname: id + '.preview.example',
        expiresAt: new Date(Date.now() + 600000), sourceType: 'UPLOAD', status: 'READY',
      });
    }
    const results = await Promise.allSettled(Array.from({length:11}, (_, index) =>
      repository.promoteOwned(user.id, prefix + String(index).padStart(16,'0'), 'quota-' + index)
    ));
    const successful = results.filter(result => result.status === 'fulfilled' && result.value !== null);
    expect(successful).toHaveLength(10);
    const count = await pool.query("SELECT count(*)::int AS count FROM previews WHERE owner_user_id=$1 AND publication_mode='PERMANENT'", [user.id]);
    expect(count.rows[0]?.count).toBe(10);
  });

  test('stale creating reconciliation claims only rows still creating', async () => {
    const users = new UserRepository(pool);
    const previews = new PreviewRepository(pool);
    const owner = await users.create();
    const staleBefore = new Date(Date.now() - 60_000);
    const old = new Date(Date.now() - 120_000);

    const staleId='p-stalecreating1234567890';
    await previews.create({ id:staleId, ownerUserId:owner.id, hostname:`${staleId}.preview.example`, expiresAt:new Date(Date.now()+600_000), sourceType:'UPLOAD' });
    await pool.query('UPDATE previews SET updated_at=$2 WHERE id=$1', [staleId, old]);

    const readyId='p-staleready1234567890abc';
    await previews.create({ id:readyId, ownerUserId:owner.id, hostname:`${readyId}.preview.example`, expiresAt:new Date(Date.now()+600_000), sourceType:'UPLOAD', status:'READY' });
    await pool.query('UPDATE previews SET updated_at=$2 WHERE id=$1', [readyId, old]);

    const claimed = await previews.claimStaleCreating(staleBefore, 100);
    expect(claimed.map((p)=>p.id)).toContain(staleId);
    expect(claimed.map((p)=>p.id)).not.toContain(readyId);
    expect((await previews.findOwnedById(owner.id, staleId))?.status).toBe('FAILED');
    expect((await previews.findOwnedById(owner.id, readyId))?.status).toBe('READY');
  });

  test('account merge preserves previews, identities and revokes source MCP tokens', async () => {
    const users = new UserRepository(pool), identities = new IdentityRepository(pool), previews = new PreviewRepository(pool);
    const destination = await users.create(), source = await users.create();
    const subject = 'merge-gh-' + source.id;
    await identities.create({ userId: destination.id, provider: 'google', providerSubject: 'merge-google-' + destination.id, email: 'dest@example.test', emailVerified: true });
    await identities.create({ userId: source.id, provider: 'github', providerSubject: subject, email: 'source@example.test', emailVerified: true });
    const ids = ['p-merge' + destination.id.replaceAll('-', ''), 'p-merge' + source.id.replaceAll('-', '')];
    for (const [index, owner] of [destination, source].entries()) {
      await previews.create({ id: ids[index]!, ownerUserId: owner.id, hostname: ids[index]! + '.example.test',
        expiresAt: new Date(Date.now() + 600_000), sourceType: 'UPLOAD', status: 'READY' });
    }
    const token = 'merge-test-token-' + source.id;
    await pool.query(`INSERT INTO mcp_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`, [source.id, token]);
    await new UserService(pool).mergeAccounts(destination.id, source.id, 'github', subject, { active: 20, permanent: 10, storage: 1_000_000 });
    expect((await previews.listOwned(destination.id)).map(p => p.id)).toEqual(expect.arrayContaining(ids));
    expect(await users.findById(source.id)).toBeNull();
    expect((await identities.findByProviderSubject('github', subject))?.userId).toBe(destination.id);
    expect((await pool.query('SELECT count(*)::int AS count FROM mcp_tokens WHERE token_hash=$1', [token])).rows[0]?.count).toBe(0);
  });

  test('account merge quota rollback preserves both accounts', async () => {
    const users = new UserRepository(pool), identities = new IdentityRepository(pool), previews = new PreviewRepository(pool);
    const destination = await users.create(), source = await users.create(), subject = 'merge-gh-' + source.id;
    await identities.create({ userId: source.id, provider: 'github', providerSubject: subject, email: 'source@example.test', emailVerified: true });
    const id = 'p-quota' + source.id.replaceAll('-', '');
    await previews.create({ id, ownerUserId: source.id, hostname: id + '.example.test',
      expiresAt: new Date(Date.now() + 600_000), sourceType: 'UPLOAD', status: 'READY' });
    await expect(new UserService(pool).mergeAccounts(destination.id, source.id, 'github', subject,
      { active: 0, permanent: 10, storage: 1000 })).rejects.toThrow('MERGE_LIMIT_EXCEEDED');
    expect(await users.findById(source.id)).not.toBeNull();
    expect((await previews.findOwnedById(source.id, id))?.id).toBe(id);
  });

});
