import type { DatabaseExecutor } from '../db.js';
import type { User } from '../../domain/models.js';

export class UserRepository {
  constructor(private readonly pool: DatabaseExecutor) {}

  async create(): Promise<User> {
    const result = await this.pool.query('INSERT INTO users DEFAULT VALUES RETURNING *');
    return mapUser(result.rows[0]!);
  }

  async touchLastLogin(id: string): Promise<void> {
    await this.pool.query('UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1', [id]);
  }

  async findById(id: string): Promise<User | null> {
    const result = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }
}

function mapUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
    lastLoginAt: row.last_login_at ? new Date(String(row.last_login_at)) : null,
  };
}
