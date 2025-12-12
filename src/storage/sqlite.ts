import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { Config } from '../models/config.js';
import { createLogger } from '../utils/logger.js';
import type { KnowledgeEntry, KnowledgeType } from '../models/knowledge.js';

const logger = createLogger('SQLite');

export interface SQLiteService {
  initialize(): void;
  saveEntry(entry: KnowledgeEntry): void;
  getEntry(id: string): KnowledgeEntry | null;
  getEntryByHash(hash: string): KnowledgeEntry | null;
  listEntries(filters?: {
    project_id?: string;
    type?: KnowledgeType;
    tags?: string[];
    limit?: number;
    offset?: number;
  }): KnowledgeEntry[];
  deleteEntry(id: string): boolean;
  updateEntry(id: string, updates: { tags?: string[]; metadata?: Record<string, unknown> }): boolean;
  updateAccessStats(id: string): void;
  getStats(project_id?: string): {
    total_entries: number;
    by_type: Record<string, number>;
    by_project: Record<string, number>;
  };
  close(): void;
}

export class SQLiteStorage implements SQLiteService {
  private db: Database.Database;

  constructor(config: Config) {
    // Ensure directory exists
    mkdirSync(dirname(config.sqlitePath), { recursive: true });

    this.db = new Database(config.sqlitePath);
    this.db.pragma('journal_mode = WAL');
    logger.info(`Initialized SQLite: ${config.sqlitePath}`);
  }

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_entries (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        tags TEXT NOT NULL,
        files TEXT,
        language TEXT,
        framework TEXT,
        chunks TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        accessed_at INTEGER,
        access_count INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_project_id ON knowledge_entries(project_id);
      CREATE INDEX IF NOT EXISTS idx_type ON knowledge_entries(type);
      CREATE INDEX IF NOT EXISTS idx_created_at ON knowledge_entries(created_at);
      CREATE INDEX IF NOT EXISTS idx_content_hash ON knowledge_entries(content_hash);

      CREATE TABLE IF NOT EXISTS entry_tags (
        entry_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (entry_id, tag),
        FOREIGN KEY (entry_id) REFERENCES knowledge_entries(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tag ON entry_tags(tag);
    `);

    logger.info('Database schema initialized');
  }

  saveEntry(entry: KnowledgeEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO knowledge_entries
      (id, project_id, content, content_hash, type, tags, files, language, framework, chunks, metadata, created_at, updated_at, access_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tagStmt = this.db.prepare(`
      INSERT INTO entry_tags (entry_id, tag) VALUES (?, ?)
    `);

    const transaction = this.db.transaction(() => {
      stmt.run(
        entry.id,
        entry.project_id,
        entry.content,
        entry.content_hash,
        entry.type,
        JSON.stringify(entry.tags),
        JSON.stringify(entry.files),
        entry.language || null,
        entry.framework || null,
        JSON.stringify(entry.chunks),
        JSON.stringify(entry.metadata),
        entry.created_at.getTime(),
        entry.updated_at.getTime(),
        entry.access_count
      );

      for (const tag of entry.tags) {
        tagStmt.run(entry.id, tag);
      }
    });

    transaction();
    logger.debug(`Saved entry ${entry.id}`);
  }

  getEntry(id: string): KnowledgeEntry | null {
    const row = this.db.prepare('SELECT * FROM knowledge_entries WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;

    if (!row) return null;
    return this.rowToEntry(row);
  }

  getEntryByHash(hash: string): KnowledgeEntry | null {
    const row = this.db.prepare('SELECT * FROM knowledge_entries WHERE content_hash = ?').get(hash) as
      | Record<string, unknown>
      | undefined;

    if (!row) return null;
    return this.rowToEntry(row);
  }

  listEntries(filters?: {
    project_id?: string;
    type?: KnowledgeType;
    tags?: string[];
    limit?: number;
    offset?: number;
  }): KnowledgeEntry[] {
    let query = 'SELECT * FROM knowledge_entries WHERE 1=1';
    const params: unknown[] = [];

    if (filters?.project_id) {
      query += ' AND project_id = ?';
      params.push(filters.project_id);
    }

    if (filters?.type) {
      query += ' AND type = ?';
      params.push(filters.type);
    }

    if (filters?.tags && filters.tags.length > 0) {
      query += ` AND id IN (
        SELECT entry_id FROM entry_tags
        WHERE tag IN (${filters.tags.map(() => '?').join(',')})
        GROUP BY entry_id
        HAVING COUNT(DISTINCT tag) = ?
      )`;
      params.push(...filters.tags, filters.tags.length);
    }

    query += ' ORDER BY created_at DESC';

    if (filters?.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    if (filters?.offset) {
      query += ' OFFSET ?';
      params.push(filters.offset);
    }

    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];
    return rows.map((row) => this.rowToEntry(row));
  }

  deleteEntry(id: string): boolean {
    const result = this.db.prepare('DELETE FROM knowledge_entries WHERE id = ?').run(id);
    return result.changes > 0;
  }

  updateEntry(id: string, updates: { tags?: string[]; metadata?: Record<string, unknown> }): boolean {
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [Date.now()];

    if (updates.tags) {
      sets.push('tags = ?');
      params.push(JSON.stringify(updates.tags));
    }

    if (updates.metadata) {
      sets.push('metadata = ?');
      params.push(JSON.stringify(updates.metadata));
    }

    params.push(id);

    const result = this.db.prepare(`UPDATE knowledge_entries SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    if (updates.tags && result.changes > 0) {
      this.db.prepare('DELETE FROM entry_tags WHERE entry_id = ?').run(id);
      const tagStmt = this.db.prepare('INSERT INTO entry_tags (entry_id, tag) VALUES (?, ?)');
      for (const tag of updates.tags) {
        tagStmt.run(id, tag);
      }
    }

    return result.changes > 0;
  }

  updateAccessStats(id: string): void {
    this.db
      .prepare(
        `
      UPDATE knowledge_entries
      SET accessed_at = ?, access_count = access_count + 1
      WHERE id = ?
    `
      )
      .run(Date.now(), id);
  }

  getStats(project_id?: string): {
    total_entries: number;
    by_type: Record<string, number>;
    by_project: Record<string, number>;
  } {
    let whereClause = '';
    const params: unknown[] = [];

    if (project_id) {
      whereClause = 'WHERE project_id = ?';
      params.push(project_id);
    }

    const total = this.db.prepare(`SELECT COUNT(*) as count FROM knowledge_entries ${whereClause}`).get(...params) as {
      count: number;
    };

    const byType = this.db
      .prepare(`SELECT type, COUNT(*) as count FROM knowledge_entries ${whereClause} GROUP BY type`)
      .all(...params) as Array<{ type: string; count: number }>;

    const byProject = this.db
      .prepare(`SELECT project_id, COUNT(*) as count FROM knowledge_entries GROUP BY project_id`)
      .all() as Array<{ project_id: string; count: number }>;

    return {
      total_entries: total.count,
      by_type: Object.fromEntries(byType.map((r) => [r.type, r.count])),
      by_project: Object.fromEntries(byProject.map((r) => [r.project_id, r.count])),
    };
  }

  close(): void {
    this.db.close();
    logger.info('Database connection closed');
  }

  private rowToEntry(row: Record<string, unknown>): KnowledgeEntry {
    return {
      id: row.id as string,
      project_id: row.project_id as string,
      content: row.content as string,
      content_hash: row.content_hash as string,
      type: row.type as KnowledgeType,
      tags: JSON.parse(row.tags as string),
      files: JSON.parse((row.files as string) || '[]'),
      language: row.language as string | undefined,
      framework: row.framework as string | undefined,
      chunks: JSON.parse(row.chunks as string),
      metadata: JSON.parse((row.metadata as string) || '{}'),
      created_at: new Date(row.created_at as number),
      updated_at: new Date(row.updated_at as number),
      accessed_at: row.accessed_at ? new Date(row.accessed_at as number) : undefined,
      access_count: row.access_count as number,
    };
  }
}

export function createSQLiteStorage(config: Config): SQLiteService {
  return new SQLiteStorage(config);
}
