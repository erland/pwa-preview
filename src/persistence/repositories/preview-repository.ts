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

  async findOwnedById(ownerUserId: string, id: string): Promise<Preview | null> {
    const result = await this.pool.query('SELECT * FROM previews WHERE id = $1 AND owner_user_id = $2', [id, ownerUserId]);
    return result.rows[0] ? mapPreview(result.rows[0]) : null;
  }

  async listOwned(ownerUserId: string): Promise<Preview[]> {
    const result = await this.pool.query(
      "SELECT * FROM previews WHERE owner_user_id = $1 AND status <> 'DELETED' ORDER BY created_at DESC",
      [ownerUserId],
    );
    return result.rows.map(mapPreview);
  }

  async findReadyById(id: string): Promise<Preview | null> {
    const result = await this.pool.query("SELECT * FROM previews WHERE id = $1 AND status = 'READY'", [id]);
    return result.rows[0] ? mapPreview(result.rows[0]) : null;
  }

  async markReady(id: string, metadata: { compressedSizeBytes:number; extractedSizeBytes:number; fileCount:number; sourceSha256:string }): Promise<Preview> {
    const result = await this.pool.query(
      `UPDATE previews SET status='READY', compressed_size_bytes=$2, extracted_size_bytes=$3, file_count=$4, source_sha256=$5, last_error_code=NULL, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, metadata.compressedSizeBytes, metadata.extractedSizeBytes, metadata.fileCount, metadata.sourceSha256],
    );
    return mapPreview(result.rows[0]!);
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

  async markFailed(id: string, code: string): Promise<void> {
    await this.pool.query("UPDATE previews SET status='FAILED', last_error_code=$2, updated_at=now() WHERE id=$1", [id, code]);
  }

  async markDeletingOwned(ownerUserId: string, id: string): Promise<Preview | null> {
    const result = await this.pool.query(
      `UPDATE previews SET status='DELETING', updated_at=now()
       WHERE id=$1 AND owner_user_id=$2 AND status <> 'DELETED'
       RETURNING *`,
      [id, ownerUserId],
    );
    return result.rows[0] ? mapPreview(result.rows[0]) : null;
  }

  async markDeletedOwned(ownerUserId: string, id: string): Promise<void> {
    await this.pool.query(
      `UPDATE previews SET status='DELETED', updated_at=now()
       WHERE id=$1 AND owner_user_id=$2`,
      [id, ownerUserId],
    );
  }

  async claimExpired(limit: number): Promise<Preview[]> {
    const result = await this.pool.query(
      `UPDATE previews SET status='EXPIRED', updated_at=now()
       WHERE id IN (SELECT id FROM previews WHERE expires_at <= now() AND status='READY' ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED)
       RETURNING *`, [limit],
    );
    return result.rows.map(mapPreview);
  }

  async listByStatus(status: PreviewStatus, limit: number): Promise<Preview[]> {
    const result = await this.pool.query('SELECT * FROM previews WHERE status=$1 ORDER BY updated_at LIMIT $2', [status, limit]);
    return result.rows.map(mapPreview);
  }

  async listStaleCreating(before: Date, limit: number): Promise<Preview[]> {
    const result = await this.pool.query("SELECT * FROM previews WHERE status='CREATING' AND updated_at < $1 ORDER BY updated_at LIMIT $2", [before, limit]);
    return result.rows.map(mapPreview);
  }

  async listActiveIds(): Promise<string[]> {
    const result = await this.pool.query("SELECT id FROM previews WHERE status NOT IN ('DELETED')");
    return result.rows.map((row) => String(row.id));
  }

  async markDeletedSystem(id: string): Promise<void> {
    await this.pool.query("UPDATE previews SET status='DELETED', updated_at=now() WHERE id=$1", [id]);
  }

  async extendOwned(ownerUserId: string, id: string, expiresAt: Date): Promise<Preview | null> {
    const result = await this.pool.query(
      `UPDATE previews SET expires_at=$3, updated_at=now()
       WHERE id=$1 AND owner_user_id=$2 AND status NOT IN ('DELETED','DELETING','EXPIRED')
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
    updatedAt: new Date(String(row.updated_at)), expiresAt: new Date(String(row.expires_at)),
    compressedSizeBytes: numberOrNull(row.compressed_size_bytes), extractedSizeBytes: numberOrNull(row.extracted_size_bytes),
    fileCount: numberOrNull(row.file_count), sourceSha256: row.source_sha256 === null ? null : String(row.source_sha256),
    sourceType: row.source_type as PreviewSourceType, lastErrorCode: row.last_error_code === null ? null : String(row.last_error_code),
  };
}
