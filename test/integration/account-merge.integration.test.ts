import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabasePool, runMigrations, type DatabasePool } from '../../src/persistence/db.js';
import { UserService } from '../../src/users/user-service.js';
import { UserRepository } from '../../src/persistence/repositories/user-repository.js';
import { IdentityRepository } from '../../src/persistence/repositories/identity-repository.js';
import { PreviewRepository } from '../../src/persistence/repositories/preview-repository.js';
import { McpTokenService } from '../../src/mcp/token-service.js';

const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
integration('account merge with PostgreSQL', () => {
  let pool: DatabasePool;
  beforeAll(async () => {
    pool = createDatabasePool(process.env.TEST_DATABASE_URL!);
    await runMigrations(pool);
  });
  afterAll(async () => { await pool.end(); });

  it('preserves both sets of previews and identities and invalidates old MCP credentials', async () => {
    const users = new UserRepository(pool);
    const identities = new IdentityRepository(pool);
    const previews = new PreviewRepository(pool);
    const a = await users.create(), b = await users.create();
    await identities.create({ userId: a.id, provider: 'google', providerSubject: 'ga-' + a.id, email: 'a@example.test', emailVerified: true });
    await identities.create({ userId: b.id, provider: 'github', providerSubject: 'gh-' + b.id, email: 'b@example.test', emailVerified: true });
    const ids = ['p-merge' + a.id.replaceAll('-', ''), 'p-merge' + b.id.replaceAll('-', '')];
    for (const [index, owner] of [a,b].entries()) {
      await previews.create({ id: ids[index]!, ownerUserId: owner.id, hostname: ids[index]! + '.example.test',
        expiresAt: new Date(Date.now() + 600_000), sourceType: 'UPLOAD', status: 'READY' });
    }
    const tokens = new McpTokenService(pool);
    const oldToken = await tokens.issue(b.id);
    await new UserService(pool).mergeAccounts(a.id, b.id, 'github', 'gh-' + b.id,
      { active: 20, permanent: 10, storage: 1_000_000 });
    expect((await previews.listOwned(a.id)).map(p => p.id)).toEqual(expect.arrayContaining(ids));
    expect(await users.findById(b.id)).toBeNull();
    expect((await identities.findByProviderSubject('github', 'gh-' + b.id))?.userId).toBe(a.id);
    expect((await pool.query('SELECT count(*)::int AS n FROM mcp_tokens WHERE user_id = $1', [b.id])).rows[0]?.n).toBe(0);
    expect(await tokens.authenticate('Bearer ' + oldToken.token)).toBeNull();
  });

  it('rejects quota overflow without changing either account', async () => {
    const users = new UserRepository(pool), identities = new IdentityRepository(pool), previews = new PreviewRepository(pool);
    const a = await users.create(), b = await users.create();
    const subject = 'gh-' + b.id;
    await identities.create({ userId: b.id, provider: 'github', providerSubject: subject, email: 'b@example.test', emailVerified: true });
    const id = 'p-quota' + b.id.replaceAll('-', '');
    await previews.create({ id, ownerUserId: b.id, hostname: id + '.example.test', expiresAt: new Date(Date.now()+600_000), sourceType: 'UPLOAD', status: 'READY' });
    await expect(new UserService(pool).mergeAccounts(a.id, b.id, 'github', subject,
      { active: 0, permanent: 10, storage: 1000 })).rejects.toThrow('MERGE_LIMIT_EXCEEDED');
    expect(await users.findById(b.id)).not.toBeNull();
    expect((await previews.findOwnedById(b.id, id))?.id).toBe(id);
  });
});
