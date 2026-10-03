import type { DatabasePool } from '../persistence/db.js';
import type { GithubIdentity } from '../auth/github-client.js';
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

  async loginWithGithub(identity: GithubIdentity): Promise<{ userId: string }> {
    if (!identity.emailVerified || !(await this.allowlist.isAllowed(identity.email, 'github'))) {
      throw new AccessDeniedError();
    }

    const existing = await this.identities.findByProviderSubject('github', identity.subject);
    if (existing) {
      await this.identities.updateProfile(existing.id, identity.email, true, identity.displayName);
      await this.users.touchLastLogin(existing.userId);
      return { userId: existing.userId };
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const userRepo = new UserRepository(client);
      const identityRepo = new IdentityRepository(client);
      const user = await userRepo.create();
      await identityRepo.create({
        userId: user.id,
        provider: 'github',
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
