import type { DatabaseExecutor } from '../db.js';
import type { AllowlistEntry } from '../../domain/models.js';

export class AllowlistRepository {
  constructor(private readonly pool: DatabaseExecutor) {}

  async add(email: string, provider: string | null = null): Promise<AllowlistEntry> {
    const result = await this.pool.query(
      'INSERT INTO allowlist_entries(provider, email) VALUES ($1, $2) RETURNING *',
      [provider, email],
    );
    return mapEntry(result.rows[0]!);
  }

  async syncGitHub(emails: readonly string[]): Promise<void> {
    if (emails.length === 0) return;
    await this.pool.query(
      `WITH desired(email) AS (
         SELECT DISTINCT lower(trim(value))
         FROM unnest($1::text[]) AS value
       ),
       upserted AS (
         INSERT INTO allowlist_entries(provider, email, enabled)
         SELECT 'github', email, true
         FROM desired
         ON CONFLICT ((coalesce(provider, '')), lower(email))
         DO UPDATE SET enabled = true, updated_at = now()
         RETURNING 1
       )
       UPDATE allowlist_entries AS existing
       SET enabled = false, updated_at = now()
       WHERE existing.provider = 'github'
         AND existing.enabled = true
         AND NOT EXISTS (
           SELECT 1 FROM desired WHERE desired.email = lower(existing.email)
         )`,
      [emails],
    );
  }

  async isAllowed(email: string, provider: string): Promise<boolean> {
    const result = await this.pool.query<{ allowed: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM allowlist_entries
         WHERE enabled = true
           AND lower(email) = lower($1)
           AND (provider IS NULL OR provider = $2)
       ) AS allowed`,
      [email, provider],
    );
    return result.rows[0]?.allowed ?? false;
  }
}

function mapEntry(row: Record<string, unknown>): AllowlistEntry {
  return {
    id: String(row.id), provider: row.provider === null ? null : String(row.provider), email: String(row.email),
    enabled: Boolean(row.enabled), createdAt: new Date(String(row.created_at)), updatedAt: new Date(String(row.updated_at)),
  };
}
