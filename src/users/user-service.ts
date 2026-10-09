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
