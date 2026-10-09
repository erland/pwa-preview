import { describe, expect, it, vi } from 'vitest';
import { UserService } from '../../src/users/user-service.js';
import type { DatabasePool } from '../../src/persistence/db.js';

function makePool(providers: string[]) {
  const identities = providers.map((provider, index) => ({ id: String(index), provider }));
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [] };
    if (sql.includes('FROM users WHERE id')) return { rows: [{ id: 'user-1' }] };
    if (sql.includes('SELECT id, provider FROM external_identities')) return { rows: [...identities] };
    if (sql.startsWith('DELETE FROM external_identities')) {
      const provider = String(params?.[1]);
      for (let i = identities.length - 1; i >= 0; i--) {
        if (identities[i]?.provider === provider) identities.splice(i, 1);
      }
      return { rows: [] };
    }
    throw new Error('Unexpected query: ' + sql);
  });
  const release = vi.fn();
  const pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as DatabasePool;
  return { pool, query, release, identities };
}

describe('unlink identity', () => {
  it('refuses to unlink the last login method', async () => {
    const mock = makePool(['github']);
    expect(await new UserService(mock.pool).unlinkProvider('user-1', 'github')).toBe('last_identity');
    expect(mock.identities).toHaveLength(1);
    expect(mock.query).not.toHaveBeenCalledWith(expect.stringContaining('DELETE FROM external_identities'), expect.anything());
    expect(mock.release).toHaveBeenCalled();
  });

  it('removes only the selected provider while preserving the account', async () => {
    const mock = makePool(['github', 'google']);
    expect(await new UserService(mock.pool).unlinkProvider('user-1', 'google')).toBe('removed');
    expect(mock.identities.map(i => i.provider)).toEqual(['github']);
    expect(mock.query).toHaveBeenCalledWith('COMMIT');
  });

  it('returns not_found for an unlinked provider', async () => {
    const mock = makePool(['github']);
    expect(await new UserService(mock.pool).unlinkProvider('user-1', 'google')).toBe('not_found');
    expect(mock.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
