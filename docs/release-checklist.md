# v1 release checklist

This checklist separates repository-verifiable gates from deployment-environment gates.

## Repository / CI gates

- [x] Node 22 TypeScript build succeeds.
- [x] React/Vite production build succeeds.
- [x] Unit test suite is green.
- [x] Security regression suite exists as a separate release gate.
- [x] PostgreSQL integration tests are wired to CI.
- [x] Full browser/API, MCP and restart/expiry E2E flows are wired to PostgreSQL CI.
- [x] Production Docker image build is wired to CI.
- [x] URL import, archive handling, owner scope and atomic update have regression coverage.
- [x] Agent Workspace signed artifact handoff has a reproducible live-smoke command.

## Deployment gates — must be checked in the real environment

- [ ] CI run with PostgreSQL passes `npm run test:integration` and `npm run test:e2e` on the release commit.
- [ ] Docker image build passes on the release commit.
- [ ] `/health` returns 200 through the production control hostname.
- [ ] `/ready` returns 200 with production PostgreSQL and `/data` mounted.
- [ ] GitHub OAuth callback succeeds on the exact production hostname.
- [ ] Session cookie is Secure/HttpOnly/SameSite and has no Domain attribute.
- [ ] UI, REST API and MCP endpoint work on the control hostname.
- [ ] Two arbitrary valid preview hostnames route without reverse-proxy reconfiguration.
- [ ] Wildcard TLS certificate is valid for preview hostnames.
- [ ] Unknown/invalid preview hostname returns 404.
- [ ] Unrelated Host header returns 404.
- [ ] Create, open, update-on-same-URL, extend and delete work in the deployed environment.
- [ ] `npm run test:agent-workspace` passes from the deployed environment with two fresh signed Agent Workspace artifact URLs.
- [ ] Backup and restore procedure has been exercised at least once against a non-production environment.

## Release decision

The repository implementation can be considered **code-complete for the planned v1 scope** when the CI gates are green. The service should be considered **production release-ready** only after all deployment gates above are checked in the target Coolify/DNS/TLS environment.
