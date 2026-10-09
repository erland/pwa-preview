import { describe, expect, it, vi } from 'vitest';
import type { DatabasePool } from '../../src/persistence/db.js';
import { UserService } from '../../src/users/user-service.js';

function database({ active = 3, permanent = 1, storage = 100, identityOwner = 'old-user' } = {}) {
  const statements: string[] = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    statements.push(sql);
    if (sql.includes('SELECT id FROM users')) return { rows: [{ id: 'new-user' }, { id: 'old-user' }] };
    if (sql.includes('SELECT user_id FROM external_identities')) return { rows: [{ user_id: identityOwner }] };
    if (sql.includes('SELECT owner_user_id,') && sql.includes('AS active')) {
      return { rows: [{ owner_user_id: 'old-user', active: String(active), permanent: String(permanent), size: String(storage) }] };
    }
    if (sql.includes('UPDATE previews') || sql.includes('UPDATE external_identities') || sql.includes('DELETE FROM users')) {
      expect(params).toEqual(['new-user', 'old-user'].slice(0, sql.includes('DELETE') ? 1 : 2).map((v, i) => sql.includes('DELETE') ? 'old-user' : v));
    }
    return { rows: [] };
  });
  const release = vi.fn();
  const pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as DatabasePool;
  return { pool, statements, query, release };
}

describe('confirmed account merge', () => {
  it('transfers publications and identities then deletes the obsolete account in one transaction', async () => {
    const db = database();
    await new UserService(db.pool).mergeAccounts('new-user', 'old-user', 'google', 'subject-123', {
      active: 20, permanent: 10, storage: 1000,
    });
    expect(db.statements).toContain('COMMIT');
    expect(db.statements.some(sql => sql.startsWith('UPDATE previews'))).toBe(true);
    expect(db.statements.some(sql => sql.startsWith('UPDATE external_identities'))).toBe(true);
    expect(db.statements.some(sql => sql.startsWith('DELETE FROM users'))).toBe(true);
    expect(db.release).toHaveBeenCalledOnce();
  });

  it('rolls back and leaves accounts untouched when merged resource limits would be exceeded', async () => {
    const db = database({ permanent: 11 });
    await expect(new UserService(db.pool).mergeAccounts('new-user', 'old-user', 'google', 'subject-123', {
      active: 20, permanent: 10, storage: 1000,
    })).rejects.toThrow('MERGE_LIMIT_EXCEEDED');
    expect(db.statements).toContain('ROLLBACK');
    expect(db.statements.some(sql => sql.startsWith('UPDATE previews'))).toBe(false);
  });

  it('rejects a changed identity ownership without migrating data', async () => {
    const db = database({ identityOwner: 'someone-else' });
    await expect(new UserService(db.pool).mergeAccounts('new-user', 'old-user', 'google', 'subject-123', {
      active: 20, permanent: 10, storage: 1000,
    })).rejects.toThrow('MERGE_ACCOUNT_CHANGED');
    expect(db.statements).toContain('ROLLBACK');
    expect(db.statements.some(sql => sql.startsWith('UPDATE previews'))).toBe(false);
  });
});
