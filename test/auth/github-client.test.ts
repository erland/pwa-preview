import { describe, expect, it, vi } from 'vitest';
import { GithubHttpClient } from '../../src/auth/github-client.js';

describe('GithubHttpClient', () => {
  it('uses a verified primary email and stable numeric subject', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 42, name: 'Test User', login: 'tester' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { email: 'other@example.com', verified: true, primary: false },
        { email: 'primary@example.com', verified: true, primary: true },
      ]), { status: 200 }));
    const client = new GithubHttpClient('id', 'secret', fetchMock as typeof fetch);
    const token = await client.exchangeCode('code');
    const identity = await client.fetchIdentity(token);
    expect(identity).toEqual({ subject: '42', email: 'primary@example.com', emailVerified: true, displayName: 'Test User' });
  });

  it('rejects an identity without a verified email', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 42, login: 'tester' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ email: 'x@example.com', verified: false, primary: true }]), { status: 200 }));
    const client = new GithubHttpClient('id', 'secret', fetchMock as typeof fetch);
    await expect(client.fetchIdentity('token')).rejects.toThrow('GITHUB_VERIFIED_EMAIL_REQUIRED');
  });
});
