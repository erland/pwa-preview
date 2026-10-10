import { describe, expect, it, vi } from 'vitest';
import { PreviewRepository } from '../../src/persistence/repositories/preview-repository.js';

describe('owner-scoped preview rename', () => {
  it('changes only the name and updates only a preview owned by the caller', async () => {
    const query = vi.fn(async (sql: string, args: unknown[]) => {
      expect(sql).toContain('SET display_name=$3');
      expect(sql).toContain('owner_user_id=$2');
      expect(sql).toContain("status NOT IN ('DELETED','DELETING','EXPIRED')");
      expect(args).toEqual(['p-example', 'owner-1', 'Nytt namn']);
      return { rows: [] };
    });
    const repo = new PreviewRepository({ query } as any);
    expect(await repo.renameOwned('owner-1', 'p-example', 'Nytt namn')).toBeNull();
    expect(query).toHaveBeenCalledOnce();
  });
});
