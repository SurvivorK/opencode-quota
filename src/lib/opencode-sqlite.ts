export interface SqliteConn {
  all<T = unknown>(sql: string, params?: unknown[]): T[];
  get<T = unknown>(sql: string, params?: unknown[]): T | null;
  close(): void;
}

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  close(): void;
}

function toParams(params?: unknown[]): unknown[] {
  return Array.isArray(params) ? params : [];
}

function runPragma(db: SqliteDatabase, sql: string): void {
  try {
    db.prepare(sql).run();
  } catch {
    // ignore
  }
}

async function createSqliteDatabase(dbPath: string): Promise<SqliteDatabase> {
  // Try Bun's built-in sqlite first
  try {
    const mod = (await import("bun:sqlite")) as {
      Database: new (path: string, options: { readonly: boolean }) => { query(sql: string): SqliteStatement; close(): void };
    };
    const bunDb = new mod.Database(dbPath, { readonly: true });
    return {
      prepare(sql: string): SqliteStatement {
        return bunDb.query(sql);
      },
      close(): void {
        try {
          bunDb.close();
        } catch {
          // ignore
        }
      },
    };
  } catch {
    // Bun not available — fall back to better-sqlite3
  }

  const BetterSqlite3 = (
    await import("better-sqlite3")
  ).default as new (path: string, options: { readonly: boolean }) => SqliteDatabase;

  return new BetterSqlite3(dbPath, { readonly: true });
}

export async function openOpenCodeSqliteReadOnly(dbPath: string): Promise<SqliteConn> {
  const db = await createSqliteDatabase(dbPath);

  // Keep reads deterministic and avoid accidental writes.
  runPragma(db, "PRAGMA query_only = ON;");

  // Avoid transient SQLITE_BUSY errors (WAL).
  runPragma(db, "PRAGMA busy_timeout = 5000;");

  return {
    all<T = unknown>(sql: string, params?: unknown[]): T[] {
      const stmt = db.prepare(sql);
      const p = toParams(params);
      return (p.length ? stmt.all(...p) : stmt.all()) as T[];
    },

    get<T = unknown>(sql: string, params?: unknown[]): T | null {
      const stmt = db.prepare(sql);
      const p = toParams(params);
      const row = (p.length ? stmt.get(...p) : stmt.get()) as T | undefined;
      return row ?? null;
    },

    close(): void {
      try {
        db.close();
      } catch {
        // ignore
      }
    },
  };
}
