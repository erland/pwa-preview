export type GithubIdentity = Readonly<{
  subject: string;
  email: string;
  emailVerified: true;
  displayName: string | null;
}>;

export interface GithubClient {
  exchangeCode(code: string): Promise<string>;
  fetchIdentity(accessToken: string): Promise<GithubIdentity>;
}

type FetchLike = typeof fetch;

export class GithubHttpClient implements GithubClient {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async exchangeCode(code: string): Promise<string> {
    const response = await this.fetchImpl('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'pwa-preview' },
      body: JSON.stringify({ client_id: this.clientId, client_secret: this.clientSecret, code }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('GITHUB_TOKEN_EXCHANGE_FAILED');
    const body = await response.json() as { access_token?: string; error?: string };
    if (!body.access_token) throw new Error('GITHUB_TOKEN_EXCHANGE_FAILED');
    return body.access_token;
  }

  async fetchIdentity(accessToken: string): Promise<GithubIdentity> {
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'pwa-preview',
    };
    const [userResponse, emailsResponse] = await Promise.all([
      this.fetchImpl('https://api.github.com/user', { headers, signal: AbortSignal.timeout(15_000) }),
      this.fetchImpl('https://api.github.com/user/emails', { headers, signal: AbortSignal.timeout(15_000) }),
    ]);
    if (!userResponse.ok || !emailsResponse.ok) throw new Error('GITHUB_IDENTITY_FETCH_FAILED');

    const user = await userResponse.json() as { id?: number; name?: string | null; login?: string };
    const emails = await emailsResponse.json() as Array<{ email?: string; primary?: boolean; verified?: boolean }>;
    const selected = emails.find((e) => e.primary && e.verified && e.email)
      ?? emails.find((e) => e.verified && e.email);
    if (!user.id || !selected?.email) throw new Error('GITHUB_VERIFIED_EMAIL_REQUIRED');

    return {
      subject: String(user.id),
      email: selected.email,
      emailVerified: true,
      displayName: user.name?.trim() || user.login?.trim() || null,
    };
  }
}
