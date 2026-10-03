import type { DatabaseExecutor } from '../db.js';
import type { ExternalIdentity } from '../../domain/models.js';

export class IdentityRepository {
  constructor(private readonly pool: DatabaseExecutor) {}

  async create(input: {
    userId: string;
    provider: string;
    providerSubject: string;
    email?: string | null;
    emailVerified?: boolean;
    displayName?: string | null;
  }): Promise<ExternalIdentity> {
    const result = await this.pool.query(
      `INSERT INTO external_identities
       (user_id, provider, provider_subject, email, email_verified, display_name)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [input.userId, input.provider, input.providerSubject, input.email ?? null, input.emailVerified ?? false, input.displayName ?? null],
    );
    return mapIdentity(result.rows[0]!);
  }

  async updateProfile(id: string, email: string, emailVerified: boolean, displayName: string | null): Promise<void> {
    await this.pool.query(
      'UPDATE external_identities SET email = $2, email_verified = $3, display_name = $4, updated_at = now() WHERE id = $1',
      [id, email, emailVerified, displayName],
    );
  }

  async findByProviderSubject(provider: string, providerSubject: string): Promise<ExternalIdentity | null> {
    const result = await this.pool.query(
      'SELECT * FROM external_identities WHERE provider = $1 AND provider_subject = $2',
      [provider, providerSubject],
    );
    return result.rows[0] ? mapIdentity(result.rows[0]) : null;
  }

  async findByUserProvider(userId: string, provider: string): Promise<ExternalIdentity | null> {
    const result = await this.pool.query(
      'SELECT * FROM external_identities WHERE user_id = $1 AND provider = $2 ORDER BY created_at LIMIT 1',
      [userId, provider],
    );
    return result.rows[0] ? mapIdentity(result.rows[0]) : null;
  }
}

function mapIdentity(row: Record<string, unknown>): ExternalIdentity {
  return {
    id: String(row.id), userId: String(row.user_id), provider: String(row.provider),
    providerSubject: String(row.provider_subject), email: row.email === null ? null : String(row.email),
    emailVerified: Boolean(row.email_verified), displayName: row.display_name === null ? null : String(row.display_name),
    createdAt: new Date(String(row.created_at)), updatedAt: new Date(String(row.updated_at)),
  };
}
