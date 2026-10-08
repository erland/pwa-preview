import type { DatabaseExecutor } from '../persistence/db.js';

export type OAuthClient = Readonly<{ clientId: string; redirectUris: readonly string[]; clientName?: string }>;
export type AuthorizationCode = Readonly<{
  codeHash: string; clientId: string; userId: string; redirectUri: string;
  scope: string; resource: string; codeChallenge: string; expiresAt: Date;
}>;
export type RefreshToken = Readonly<{
  tokenHash: string; clientId: string; userId: string; scope: string; resource: string; expiresAt: Date;
}>;

export class OAuthStore {
  constructor(private readonly db: DatabaseExecutor) {}

  async registerClient(client: OAuthClient): Promise<void> {
    await this.db.query(
      `INSERT INTO oauth_clients(client_id, redirect_uris, client_name)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (client_id) DO NOTHING`,
      [client.clientId, JSON.stringify(client.redirectUris), client.clientName ?? null],
    );
  }

  async findClient(clientId: string): Promise<OAuthClient | null> {
    const result = await this.db.query<{ client_id:string; redirect_uris:unknown; client_name:string|null }>(
      'SELECT client_id, redirect_uris, client_name FROM oauth_clients WHERE client_id = $1',
      [clientId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const redirectUris = Array.isArray(row.redirect_uris)
      ? row.redirect_uris.map(String)
      : JSON.parse(String(row.redirect_uris)) as string[];
    return {
      clientId: row.client_id,
      redirectUris,
      ...(row.client_name ? { clientName: row.client_name } : {}),
    };
  }

  async saveAuthorizationCode(code: AuthorizationCode): Promise<void> {
    await this.db.query(
      `INSERT INTO oauth_authorization_codes
       (code_hash, client_id, user_id, redirect_uri, scope, resource, code_challenge, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [code.codeHash, code.clientId, code.userId, code.redirectUri, code.scope, code.resource, code.codeChallenge, code.expiresAt],
    );
  }

  async consumeAuthorizationCode(codeHash: string): Promise<AuthorizationCode | null> {
    const result = await this.db.query<{
      code_hash:string; client_id:string; user_id:string; redirect_uri:string;
      scope:string; resource:string; code_challenge:string; expires_at:Date|string;
    }>(
      `DELETE FROM oauth_authorization_codes
       WHERE code_hash = $1 AND expires_at > now()
       RETURNING code_hash, client_id, user_id, redirect_uri, scope, resource, code_challenge, expires_at`,
      [codeHash],
    );
    const row = result.rows[0];
    return row ? {
      codeHash: row.code_hash, clientId: row.client_id, userId: row.user_id, redirectUri: row.redirect_uri,
      scope: row.scope, resource: row.resource, codeChallenge: row.code_challenge, expiresAt: new Date(row.expires_at),
    } : null;
  }

  async saveRefreshToken(token: RefreshToken): Promise<void> {
    await this.db.query(
      `INSERT INTO oauth_refresh_tokens(token_hash, client_id, user_id, scope, resource, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (token_hash) DO NOTHING`,
      [token.tokenHash, token.clientId, token.userId, token.scope, token.resource, token.expiresAt],
    );
  }

  async consumeRefreshToken(tokenHash: string, clientId: string): Promise<RefreshToken | null> {
    const result = await this.db.query<{
      token_hash:string; client_id:string; user_id:string; scope:string; resource:string; expires_at:Date|string;
    }>(
      `UPDATE oauth_refresh_tokens SET rotated_at = COALESCE(rotated_at, now())
       WHERE token_hash = $1 AND client_id = $2 AND expires_at > now()
         AND (rotated_at IS NULL OR rotated_at >= now() - interval '30 seconds')
       RETURNING token_hash, client_id, user_id, scope, resource, expires_at`,
      [tokenHash, clientId],
    );
    const row = result.rows[0];
    return row ? {
      tokenHash: row.token_hash, clientId: row.client_id, userId: row.user_id,
      scope: row.scope, resource: row.resource, expiresAt: new Date(row.expires_at),
    } : null;
  }
}
