import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@andx/contracts';

loadEnv();

const { Pool } = pg;

let poolInstance: pg.Pool | null = null;

export interface DbConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

/**
 * Returns or creates the singleton connection pool.
 */
export function getPool(customConfig?: DbConfig): pg.Pool {
  if (poolInstance) {
    return poolInstance;
  }

  const connectionString =
    customConfig?.connectionString ||
    process.env.DATABASE_URL ||
    undefined;

  const config: pg.PoolConfig = connectionString
    ? { connectionString }
    : {
        host: customConfig?.host || process.env.POSTGRES_HOST || process.env.PGHOST || 'localhost',
        port: customConfig?.port || (process.env.POSTGRES_PORT ? parseInt(process.env.POSTGRES_PORT, 10) : process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432),
        user: customConfig?.user || process.env.POSTGRES_USER || process.env.PGUSER || 'andx',
        password: customConfig?.password || process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD || 'andx_secret',
        database: customConfig?.database || process.env.POSTGRES_DB || process.env.PGDATABASE || 'andx_db',
      };

  config.max = customConfig?.max || (process.env.PGMAX_POOL ? parseInt(process.env.PGMAX_POOL, 10) : 30);
  config.idleTimeoutMillis = customConfig?.idleTimeoutMillis || 30000;
  config.connectionTimeoutMillis = customConfig?.connectionTimeoutMillis || 5000;

  poolInstance = new Pool(config);

  poolInstance.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client:', err);
  });

  return poolInstance;
}

/**
 * Executes a parameterized SQL query on the pool.
 */
export async function query<R extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<R>> {
  const pool = getPool();
  return pool.query<R>(text, params);
}

/**
 * Executes the database migration scripts to initialize all schemas and tables.
 */
export async function runMigrations(customPool?: pg.Pool): Promise<void> {
  const pool = customPool || getPool();
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(__dirname, '../migrations');

  if (!fs.existsSync(migrationsDir)) {
    console.warn(`Migrations directory not found at ${migrationsDir}`);
    return;
  }

  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const fullPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(fullPath, 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      console.log(`Executed migration: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Migration ${file} failed:`, err);
      throw err;
    } finally {
      client.release();
    }
  }
}

/**
 * Gracefully shuts down the connection pool.
 */
export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}
