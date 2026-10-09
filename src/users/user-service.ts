import type { DatabasePool } from '../persistence/db.js';
import type { GithubIdentity } from '../auth/github-client.js';
export type LoginIdentity = GithubIdentity;
import { AllowlistRepository } from '../persistence/repositories/allowlist-repository.js';
import { IdentityRepository } from '../persistence/repositories/identity-repository.js';
import { UserRepository } from '../persistence/repositories/user-repository.js';

export class AccessDeniedError extends Error {
  constructor() { super('IDENTITY_NOT_ALLOWLISTED'); }
}

export class UserService {
  private readonly allowlist: AllowlistRepository;
  private readonly identities: IdentityRepository;
  private readonly users: UserRepository;

  constructor(private readonly pool: DatabasePool) {
    this.allowlist = new AllowlistRepository(pool);
    this.identities = new IdentityRepository(pool);
    this.users = new UserRepository(pool);
  }

  async isUserAllowed(userId: string): Promise<boolean> {
    const result = await this.pool.query<{ allowed: boolean }>(`SELECT EXISTS (SELECT 1 FROM external_identities i JOIN allowlist_entries a ON lower(a.email)=lower(i.email) AND (a.provider IS NULL OR a.provider=i.provider) AND a.enabled=true WHERE i.user_id=$1 AND i.email_verified=true) AS allowed`, [userId]);
    return result.rows[0]?.allowed ?? false;
  }

  async getMergePreview(destinationId: string, sourceId: string): Promise<{ currentPreviews: number; otherPreviews: number; currentPermanent: number; otherPermanent: number } | null> {
    if (destinationId === sourceId) return null;
    const result = await this.pool.query<{ owner_user_id: string; total: string; permanent: string }>(
      `SELECT owner_user_id, count(*) FILTER (WHERE status NOT IN ('DELETED', 'EXPIRED'))::text AS total,
              count(*) FILTER (WHERE publication_mode = 'PERMANENT' AND status = 'READY')::text AS permanent
         FROM previews WHERE owner_user_id = ANY($1::uuid[]) GROUP BY owner_user_id`,
      [[destinationId, sourceId]],
    );
    const find = (id: string) => result.rows.find(r => r.owner_user_id === id);
    return { currentPreviews: Number(find(destinationId)?.total ?? 0), otherPreviews: Number(find(sourceId)?.total ?? 0),
      currentPermanent: Number(find(destinationId)?.permanent ?? 0), otherPermanent: Number(find(sourceId)?.permanent ?? 0) };
  }

  async mergeAccounts(destinationId: string, sourceId: string, provider: 'github' | 'google', subject: string,
    limits: { active: number; permanent: number; storage: number }): Promise<void> {
    if (sourceId === destinationId) throw new Error('INVALID_MERGE');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Take locks in deterministic order to avoid deadlocks during simultaneous account operations.
      const users = await client.query<{ id: string }>(
        'SELECT id FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[destinationId, sourceId]],
      );
      if (users.rows.length !== 2) throw new Error('MERGE_ACCOUNT_CHANGED');
      const identity = await client.query<{ user_id: string }>(
        'SELECT user_id FROM external_identities WHERE provider = $1 AND provider_subject = $2 FOR UPDATE', [provider, subject],
      );
      if (identity.rows[0]?.user_id !== sourceId) throw new Error('MERGE_ACCOUNT_CHANGED');
      const stats = await client.query<{ owner_user_id: string; active: string; permanent: string; size: string }>(
        `SELECT owner_user_id,
             count(*) FILTER (WHERE status NOT IN ('DELETED','EXPIRED'))::text AS active,
             count(*) FILTER (WHERE publication_mode = 'PERMANENT' AND status = 'READY')::text AS permanent,
             coalesce(sum(coalesce(extracted_size_bytes,0)) FILTER (WHERE status NOT IN ('DELETED','EXPIRED')),0)::text AS size
           FROM previews WHERE owner_user_id = ANY($1::uuid[]) GROUP BY owner_user_id`, [[destinationId, sourceId]],
      );
      const sum = (key: 'active' | 'permanent' | 'size') => stats.rows.reduce((acc, r) => acc + Number(r[key]), 0);
      if (sum('active') > limits.active || sum('permanent') > limits.permanent || sum('size') > limits.storage) throw new Error('MERGE_LIMIT_EXCEEDED');
      await client.query('UPDATE previews SET owner_user_id = $1 WHERE owner_user_id = $2', [destinationId, sourceId]);
      await client.query('UPDATE external_identities SET user_id = $1 WHERE user_id = $2', [destinationId, sourceId]);
      // Deleting the obsolete account cascades to all MCP and OAuth credentials. Existing browser
      // sessions with the old user ID fail the next authorization check.
      await client.query('DELETE FROM users WHERE id = $1', [sourceId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async unlinkProvider(userId: string, provider: 'github' | 'google'): Promise<'removed' | 'not_found' | 'last_identity'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serializing account changes prevents concurrent requests from removing both login methods.
      const locked = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (locked.rows.length === 0) {
        await client.query('ROLLBACK');
        return 'not_found';
      }
      const identities = await client.query<{ id: string; provider: string }>(
        'SELECT id, provider FROM external_identities WHERE user_id = $1 FOR UPDATE', [userId],
      );
      const selected = identities.rows.filter((identity) => identity.provider === provider);
      if (selected.length === 0) {
        await client.query('ROLLBACK');
        return 'not_found';
      }
      if (identities.rows.length <= selected.length) {
        await client.query('ROLLBACK');
        return 'last_identity';
      }
      await client.query('DELETE FROM external_identities WHERE user_id = $1 AND provider = $2', [userId, provider]);
      await client.query('COMMIT');
      return 'removed';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async loginWithGithub(identity: GithubIdentity): Promise<{ userId: string }> { return this.loginWithProvider('github', identity); }

  async loginWithProvider(provider: 'github' | 'google', identity: LoginIdentity, linkUserId?: string): Promise<{ userId: string }> {
    if (!identity.emailVerified || !(await this.allowlist.isAllowed(identity.email, provider))) {
      throw new AccessDeniedError();
    }

    const existing = await this.identities.findByProviderSubject(provider, identity.subject);
    if (existing) {
      if (linkUserId && existing.userId !== linkUserId) throw new Error('IDENTITY_ALREADY_LINKED');
      await this.identities.updateProfile(existing.id, identity.email, true, identity.displayName);
      await this.users.touchLastLogin(existing.userId);
      return { userId: existing.userId };
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const userRepo = new UserRepository(client);
      const identityRepo = new IdentityRepository(client);
      const user = linkUserId ? await userRepo.findById(linkUserId) : await userRepo.create();
      if (!user) throw new Error('USER_NOT_FOUND');
      await identityRepo.create({
        userId: user.id,
        provider,
        providerSubject: identity.subject,
        email: identity.email,
        emailVerified: true,
        displayName: identity.displayName,
      });
      await userRepo.touchLastLogin(user.id);
      await client.query('COMMIT');
      return { userId: user.id };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
