# Optional Google sign-in

GitHub remains the default sign-in provider. Google is enabled only when both
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are configured.

## Google Cloud setup

Create an OAuth 2.0 Web application in Google Cloud Console.
Set the authorized redirect URI to:

```
https://pwa-preview.apphome.one/auth/callback/google
```

Configure the OAuth consent screen for the intended audience. Include
openid, email and profile scopes. Set Coolify environment variables:

```dotenv
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
PWA_PREVIEW_GOOGLE_ALLOWLIST_EMAILS=user@example.com
```

Keep the GitHub settings unchanged. The Google allowlist is synced on startup
when nonempty; an empty or missing list leaves database entries untouched.
A provider-neutral allowlist entry also permits Google login.

## Identity and account ownership

New Google identities get an independent internal user ID. Email address
matching alone never merges accounts. To retain existing previews, first
sign in using GitHub, then select **Koppla Google-konto**. Sign out and
choose Google thereafter; the same internal user ID owns all previews.

The link operation requires an authenticated browser session, a unique OAuth
state, PKCE and a provider-bound callback. An identity already linked to
another user cannot be relinked. Disabling every allowlisted identity
revokes browser access and MCP bearer-token authentication on the next check.

The Google token is checked using Google's tokeninfo endpoint for
signature, issuer, audience and expiry validation. This approach is suitable
for low-volume installations; a local OIDC JWKS verifier can replace
the verification request at higher volumes.

## Rollout

1. Deploy code without Google environment variables and verify GitHub login.
2. Create Google OAuth credentials and configure the allowlist in Coolify.
3. Restart, test login with an allowed Google identity and reject a denied one.
4. Test account linking with an existing GitHub account and confirm existing
   previews remain visible.
5. Check both browser sessions and MCP access after an allowlist change.
