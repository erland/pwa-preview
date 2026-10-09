export type GoogleIdentity = Readonly<{ subject: string; email: string; emailVerified: true; displayName: string | null }>;

export class GoogleOidcClient {
  constructor(private readonly clientId: string, private readonly clientSecret: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async exchangeCode(code: string, redirectUri: string, verifier: string): Promise<GoogleIdentity> {
    const tokenResponse = await this.fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: this.clientId, client_secret: this.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }),
      signal: AbortSignal.timeout(15000),
    });
    if (!tokenResponse.ok) throw new Error('GOOGLE_TOKEN_EXCHANGE_FAILED');
    const tokens = await tokenResponse.json() as { id_token?: string };
    if (!tokens.id_token) throw new Error('GOOGLE_ID_TOKEN_REQUIRED');
    const verify = await this.fetchImpl('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(tokens.id_token), { signal: AbortSignal.timeout(15000) });
    if (!verify.ok) throw new Error('GOOGLE_TOKEN_VERIFICATION_FAILED');
    const claims = await verify.json() as { aud?: string; iss?: string; sub?: string; email?: string; email_verified?: string | boolean; name?: string; exp?: string };
    if (claims.aud !== this.clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss ?? '') || !claims.sub || !claims.email || (claims.email_verified !== true && claims.email_verified !== 'true') || !claims.exp || Number(claims.exp) * 1000 <= Date.now()) throw new Error('GOOGLE_INVALID_IDENTITY');
    return { subject: claims.sub, email: claims.email, emailVerified: true, displayName: claims.name ?? null };
  }
}
