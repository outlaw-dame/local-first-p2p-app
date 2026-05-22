import { PGlite } from '@electric-sql/pglite';

export type SearchProjectionRecord = Readonly<{
  sourceId: string;
  kind: string;
  title: string;
  body: string;
  createdAt: string;
}>;

export type SearchResult = SearchProjectionRecord &
  Readonly<{
    rank: number;
  }>;

export class PgliteSearchProjection {
  readonly #db: PGlite;
  #initialized = false;

  constructor(dataDir = 'idb://lfp2p-search') {
    this.#db = new PGlite(dataDir);
  }

  async init(): Promise<void> {
    if (this.#initialized) return;
    await this.#db.query(`
      CREATE TABLE IF NOT EXISTS search_projection (
        source_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        searchable_text TEXT NOT NULL
      );
    `);
    this.#initialized = true;
  }

  async upsert(record: SearchProjectionRecord): Promise<void> {
    await this.init();
    const searchableText = `${record.title}\n${record.body}`.toLocaleLowerCase();
    await this.#db.query(
      `INSERT INTO search_projection (source_id, kind, title, body, created_at, searchable_text)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (source_id) DO UPDATE SET
         kind = excluded.kind,
         title = excluded.title,
         body = excluded.body,
         created_at = excluded.created_at,
         searchable_text = excluded.searchable_text;`,
      [record.sourceId, record.kind, record.title, record.body, record.createdAt, searchableText]
    );
  }

  async searchText(query: string, limit = 20): Promise<SearchResult[]> {
    await this.init();
    const sanitized = query.trim().toLocaleLowerCase();
    if (sanitized.length === 0) return [];
    const result = await this.#db.query<SearchProjectionRecord & { rank: number }>(
      `SELECT
         source_id as "sourceId",
         kind,
         title,
         body,
         created_at as "createdAt",
         1 as rank
       FROM search_projection
       WHERE searchable_text LIKE $1
       ORDER BY created_at DESC
       LIMIT $2;`,
      [`%${sanitized.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`, limit]
    );
    return result.rows;
  }
}
