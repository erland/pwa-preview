import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DatabaseExecutor } from '../persistence/db.js';

const TOKEN_PREFIX = 'pwp_';
const DEFAULT_TOKEN_DAYS = 90;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type IssuedMcpToken = Readonly<{ token: string; expiresAt: Date }>;

export class McpTokenService {
  constructor(private readonly db: DatabaseExecutor) {}

  async issue(userId: string, days = DEFAULT_TOKEN_DAYS): Promise<IssuedMcpToken> {
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('INVALID_TOKEN_LIFETIME');
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await this.db.query(
      'INSERT INTO mcp_tokens(user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [userId, hashToken(token), expiresAt],
    );
    return { token, expiresAt };
  }

  async authenticate(authorization: string | undefined): Promise<string | null> {
    const token = parseBearer(authorization);
    if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
    const digest = hashToken(token);
    const result = await this.db.query<{ user_id: string; token_hash: string }>(
      `SELECT t.user_id, t.token_hash
         FROM mcp_tokens t
        WHERE t.token_hash = $1
          AND t.revoked_at IS NULL
          AND t.expires_at > now()
          AND EXISTS (
            SELECT 1
              FROM external_identities i
             WHERE i.user_id = t.user_id
               AND i.email_verified = true
               AND i.email IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM allowlist_entries a
                  WHERE a.enabled = true
                    AND lower(a.email) = lower(i.email)
                    AND (a.provider IS NULL OR a.provider = i.provider)
               )
          )
        LIMIT 1`,
      [digest],
    );
    const row = result.rows[0];
    if (!row) return null;
    const actual = Buffer.from(digest);
    const expected = Buffer.from(row.token_hash);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    await this.db.query('UPDATE mcp_tokens SET last_used_at = now() WHERE token_hash = $1', [digest]);
    return String(row.user_id);
  }

  async revokeAll(userId: string): Promise<number> {
    const result = await this.db.query(
      'UPDATE mcp_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
    return result.rowCount ?? 0;
  }
}

export function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
