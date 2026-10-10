import type { DatabaseExecutor } from '../db.js';
import type { Preview, PreviewSourceType, PreviewStatus } from '../../domain/models.js';

export class PreviewRepository {
  constructor(private readonly pool: DatabaseExecutor) {}

  async create(input: {
    id: string;
    ownerUserId: string;
    hostname: string;
    expiresAt: Date;
    sourceType: PreviewSourceType;
    displayName?: string | null;
    status?: PreviewStatus;
  }): Promise<Preview> {
    const result = await this.pool.query(
      `INSERT INTO previews(id, owner_user_id, display_name, status, hostname, expires_at, source_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [input.id, input.ownerUserId, input.displayName ?? null, input.status ?? 'CREATING', input.hostname, input.expiresAt, input.sourceType],
    );
    return mapPreview(result.rows[0]!);
  }

  async renameOwned(ownerUserId: string, id: string, name: string): Promise<Preview | null> {
    const result = await this.pool.query(
      "UPDATE previews SET display_name=$3, updated_at=now() WHERE id=$1 AND owner_user_id=$2 AND status NOT IN ('DELETED','DELETING','EXPIRED') RETURNING *",
      [id, ownerUserId, name],
    );
    return result.rows[0] ? mapPreview(result.rows[0]) : null;
  }

  async findOwnedById(ownerUserId: string, id: string): Promise<Preview | null> {
    const result = await this.pool.query('SELECT * FROM previews WHERE id = $1 AND owner_user_id = $2', [id, ownerUserId]);
    return result.rows[0] ? mapPreview(result.rows[0]) : null;
  }

  async countActiveOwned(ownerUserId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM previews WHERE owner_user_id = $1 AND status IN ('CREATING','READY')",
      [ownerUserId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async sumReadyExtractedBytesOwned(ownerUserId: string): Promise<number> {
    const result = await this.pool.query<{ bytes: string }>(
      "SELECT coalesce(sum(extracted_size_bytes),0)::text AS bytes FROM previews WHERE owner_user_id = $1 AND status = 'READY'",
      [ownerUserId],
    );
    return Number(result.rows[0]?.bytes ?? 0);
  }

  async sumReadyExtractedBytesTotal(): Promise<number> {
    const result = await this.pool.query<{ bytes: string }>(
      "SELECT coalesce(sum(extracted_size_bytes),0)::text AS bytes FROM previews WHERE status = 'READY'",
    );
    return Number(result.rows[0]?.bytes ?? 0);
  }

  async listOwned(ownerUserId: string): Promise<Preview[]> {
    const result = await this.pool.query(
      "SELECT * FROM previews WHERE owner_user_id = $1 AND status <> 'DELETED' ORDER BY created_at DESC",
      [ownerUserId],
    );
    return result.rows.map(mapPreview);
  }

  async findReadyBySlug(slug: string): Promise<Preview | null> {
    const result = await this.pool.query("SELECT * FROM previews WHERE slug=$1 AND publication_mode='PERMANENT' AND status='READY'", [slug]);
    return result.rows[0] ? mapPreview(result.rows[0]) : null;
  }

  async promoteOwned(ownerUserId: string, id: string, slug: string): Promise<Preview | null> {
    const result = await this.pool.query(`
      UPDATE previews SET publication_mode='PERMANENT', slug=$3, expires_at=NULL, updated_at=now()
      WHERE id=$1 AND owner_user_id=$2 AND status='READY' AND publication_mode='TEMPORARY'
        AND expires_at > now()
        AND (SELECT count(*) FROM previews WHERE owner_user_id=$2 AND publication_mode='PERMANENT' AND status='READY') < 10
      RETURNING *`, [id, ownerUserId, slug]);
    return result.rows[0] ? mapPreview(result.rows[0]) : null;
  }

  async findReadyById(id: string): Promise<Preview | null> {
    const result = await this.pool.query("SELECT * FROM previews WHERE id = $1 AND status = 'READY'", [id]);
    return result.rows[0] ? mapPreview(result.rows[0]) : null;
  }

  async markReadyFromCreating(id: string, metadata: { compressedSizeBytes:number; extractedSizeBytes:number; fileCount:number; sourceSha256:string }): Promise<Preview | null> {
    const result = await this.pool.query(
      `UPDATE previews SET status='READY', compressed_size_bytes=$2, extracted_size_bytes=$3, file_count=$4, source_sha256=$5, last_error_code=NULL, updated_at=now()
       WHERE id=$1 AND status='CREATING'
       RETURNING *`,
      [id, metadata.compressedSizeBytes, metadata.extractedSizeBytes, metadata.fileCount, metadata.sourceSha256],
    );
    return result.rows[0] ? mapPreview(result.rows[0]) : null;
  }

  async markUpdatedOwned(ownerUserId: string, id: string, metadata: { compressedSizeBytes:number; extractedSizeBytes:number; fileCount:number; sourceSha256:string; sourceType: PreviewSourceType }): Promise<Preview | null> {
    const result = await this.pool.query(
      `UPDATE previews SET compressed_size_bytes=$3, extracted_size_bytes=$4, file_count=$5, source_sha256=$6, source_type=$7, last_error_code=NULL, updated_at=now()
       WHERE id=$1 AND owner_user_id=$2 AND status='READY'
       RETURNING *`,
      [id, ownerUserId, metadata.compressedSizeBytes, metadata.extractedSizeBytes, metadata.fileCount, metadata.sourceSha256, metadata.sourceType],
    );
    return result.rows[0] ? mapPreview(result.rows[0]) : null;
  }

  async markFailedFromCreating(id: string, code: string): Promise<boolean> {
    const result = await this.pool.query(
      "UPDATE previews SET status='FAILED', last_error_code=$2, updated_at=now() WHERE id=$1 AND status='CREATING' RETURNING id",
      [id, code],
    );
    return (result.rowCount ?? result.rows.length) > 0;
  }

  async markDeletingOwned(ownerUserId: string, id: string): Promise<Preview | null> {
    const result = await this.pool.query(
      `UPDATE previews SET status='DELETING', updated_at=now()
       WHERE id=$1 AND owner_user_id=$2 AND status IN ('CREATING','READY','FAILED','EXPIRED','DELETING')
       RETURNING *`,
      [id, ownerUserId],
    );
    return result.rows[0] ? mapPreview(result.rows[0]) : null;
  }

  async markDeletedOwnedFromDeleting(ownerUserId: string, id: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE previews SET status='DELETED', updated_at=now()
       WHERE id=$1 AND owner_user_id=$2 AND status='DELETING'
       RETURNING id`,
      [id, ownerUserId],
    );
    return (result.rowCount ?? result.rows.length) > 0;
  }

  async claimExpired(limit: number): Promise<Preview[]> {
    const result = await this.pool.query(
      `UPDATE previews SET status='EXPIRED', updated_at=now()
       WHERE id IN (SELECT id FROM previews WHERE publication_mode='TEMPORARY' AND expires_at <= now() AND status='READY' ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED)
       RETURNING *`, [limit],
    );
    return result.rows.map(mapPreview);
  }

  async listByStatus(status: PreviewStatus, limit: number): Promise<Preview[]> {
    const result = await this.pool.query('SELECT * FROM previews WHERE status=$1 ORDER BY updated_at LIMIT $2', [status, limit]);
    return result.rows.map(mapPreview);
  }

  async claimStaleCreating(before: Date, limit: number): Promise<Preview[]> {
    const result = await this.pool.query(
      `UPDATE previews SET status='FAILED', last_error_code='STALE_CREATING', updated_at=now()
       WHERE id IN (
         SELECT id FROM previews
         WHERE status='CREATING' AND updated_at < $1
         ORDER BY updated_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [before, limit],
    );
    return result.rows.map(mapPreview);
  }

  async listActiveIds(): Promise<string[]> {
    const result = await this.pool.query("SELECT id FROM previews WHERE status NOT IN ('DELETED')");
    return result.rows.map((row) => String(row.id));
  }

  async isActiveId(id: string): Promise<boolean> {
    const result = await this.pool.query(
      "SELECT 1 FROM previews WHERE id=$1 AND status NOT IN ('DELETED') LIMIT 1",
      [id],
    );
    return result.rows.length > 0;
  }

  async markDeletedSystemFromDeleting(id: string): Promise<boolean> {
    const result = await this.pool.query(
      "UPDATE previews SET status='DELETED', updated_at=now() WHERE id=$1 AND status='DELETING' RETURNING id",
      [id],
    );
    return (result.rowCount ?? result.rows.length) > 0;
  }

  async markDeletedSystemFromExpired(id: string): Promise<boolean> {
    const result = await this.pool.query(
      "UPDATE previews SET status='DELETED', updated_at=now() WHERE id=$1 AND status='EXPIRED' RETURNING id",
      [id],
    );
    return (result.rowCount ?? result.rows.length) > 0;
  }

  async extendOwned(ownerUserId: string, id: string, expiresAt: Date): Promise<Preview | null> {
    const result = await this.pool.query(
      `UPDATE previews SET expires_at=$3, updated_at=now()
       WHERE id=$1 AND owner_user_id=$2 AND publication_mode='TEMPORARY' AND status NOT IN ('DELETED','DELETING','EXPIRED')
       RETURNING *`,
      [id, ownerUserId, expiresAt],
    );
    return result.rows[0] ? mapPreview(result.rows[0]) : null;
  }
}

function numberOrNull(value: unknown): number | null { return value === null ? null : Number(value); }
function mapPreview(row: Record<string, unknown>): Preview {
  return {
    id: String(row.id), ownerUserId: String(row.owner_user_id), displayName: row.display_name === null ? null : String(row.display_name),
    status: row.status as PreviewStatus, hostname: String(row.hostname), createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)), expiresAt: row.expires_at === null ? null : new Date(String(row.expires_at)), publicationMode: (row.publication_mode ?? 'TEMPORARY') as Preview['publicationMode'], slug: row.slug == null ? null : String(row.slug),
    compressedSizeBytes: numberOrNull(row.compressed_size_bytes), extractedSizeBytes: numberOrNull(row.extracted_size_bytes),
    fileCount: numberOrNull(row.file_count), sourceSha256: row.source_sha256 === null ? null : String(row.source_sha256),
    sourceType: row.source_type as PreviewSourceType, lastErrorCode: row.last_error_code === null ? null : String(row.last_error_code),
  };
}
