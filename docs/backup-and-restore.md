# Backup and restore

A v1 deployment has two persistent data sets that must be treated together:

1. PostgreSQL metadata.
2. The persistent `/data` volume containing preview files.

## PostgreSQL

Back up the production database using the PostgreSQL tooling supported by the hosting environment, for example a logical `pg_dump` or provider-managed snapshot.

The database contains users, external identities, allowlist entries, preview metadata, MCP token hashes and migration state.

## `/data`

Back up the persistent volume containing:

```text
/data/previews/
/data/staging/
/data/tmp/
```

The durable data of interest is primarily `/data/previews`; `staging` and `tmp` are transient and reconciliation can clean stale content.

## Consistency

For the cleanest backup, coordinate the database and volume snapshots closely. Because preview metadata and filesystem publication are separate persistence layers, a snapshot taken during create/update/delete may capture an in-progress lifecycle state.

The reconciliation job is designed to heal interrupted `CREATING`/`DELETING` operations and stale staging after restart, but a restore should still be validated before normal traffic resumes.

## Restore outline

1. Stop or isolate the application so only one active instance can write.
2. Restore PostgreSQL.
3. Restore `/data` to the matching snapshot.
4. Confirm ownership/permissions allow the non-root `node` runtime to read/write `/data`.
5. Run the current database migrations.
6. Start one application instance.
7. Allow startup reconciliation to complete.
8. Verify `/ready`, representative existing previews, create/update/delete, and cleanup.

## v1 limitation

The local-volume implementation assumes one active application instance. Backups/restores must not be used as a path to multiple independently writable copies of the same `/data` plus database state.
