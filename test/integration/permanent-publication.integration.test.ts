import { describe, expect, it } from 'vitest';
import { PreviewRepository } from '../../src/persistence/repositories/preview-repository.js';
import { UserRepository } from '../../src/persistence/repositories/user-repository.js';
import { createDatabasePool, runMigrations } from '../../src/persistence/db.js';

const test = process.env.TEST_DATABASE_URL ? it : it.skip;
describe('Permanent publication persistence', () => {
  test('promotes to readable address and skips TTL cleanup', async () => {
    const pool = createDatabasePool(process.env.TEST_DATABASE_URL!);
    try {
      await runMigrations(pool);
      const owner = await new UserRepository(pool).create();
      const previews = new PreviewRepository(pool);
      const id = 'p-' + 'f'.repeat(32);
      await previews.create({id, ownerUserId:owner.id, hostname:id+'.preview.example', expiresAt:new Date(Date.now()+600000), sourceType:'UPLOAD', status:'READY'});
      const changed = await previews.promoteOwned(owner.id,id,'friendly-preview-test');
      expect(changed?.expiresAt).toBeNull();
      expect(changed?.publicationMode).toBe('PERMANENT');
      expect((await previews.findReadyBySlug('friendly-preview-test'))?.id).toBe(id);
      expect((await previews.claimExpired(100)).some(x=>x.id===id)).toBe(false);
      expect(await previews.promoteOwned(owner.id,id,'another-name')).toBeNull();
    } finally { await pool.end(); }
  });
});
