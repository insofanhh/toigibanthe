import mysql, {
  type PoolConnection,
  type RowDataPacket,
  type ResultSetHeader,
} from "mysql2/promise";

const globalDB = globalThis as unknown as { mysqlPool?: mysql.Pool };
export function pool() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL chưa được cấu hình.");
  if (!globalDB.mysqlPool) {
    const url = new URL(process.env.DATABASE_URL);
    globalDB.mysqlPool = mysql.createPool({
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.slice(1),
      ssl:
        process.env.DATABASE_SSL === "true"
          ? { rejectUnauthorized: true }
          : undefined,
      waitForConnections: true,
      connectionLimit: 5,
      maxIdle: 2,
      idleTimeout: 60000,
      timezone: "Z",
      dateStrings: true,
      decimalNumbers: true,
      charset: "utf8mb4",
    });
  }
  return globalDB.mysqlPool;
}
export type DB = mysql.Pool | PoolConnection;
export async function rows<T = Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
  db: DB = pool(),
): Promise<T[]> {
  const [result] = await db.query<RowDataPacket[]>(sql, values);
  return result as T[];
}
export async function exec(
  sql: string,
  values: unknown[] = [],
  db: DB = pool(),
) {
  const [result] = await db.query<ResultSetHeader>(sql, values);
  return result;
}
export async function transaction<T>(
  fn: (db: PoolConnection) => Promise<T>,
  attempt = 0,
): Promise<T> {
  const db = await pool().getConnection();
  try {
    await db.beginTransaction();
    const result = await fn(db);
    await db.commit();
    return result;
  } catch (error) {
    await db.rollback();
    const e = error as { code?: string; errno?: number; sqlState?: string };
    if (!(
      attempt < 3 &&
      (e.code === "ER_LOCK_DEADLOCK" ||
        e.code === "ER_LOCK_WAIT_TIMEOUT" ||
        e.errno === 9007 ||
        e.sqlState === "40001")
    ))
      throw error;
  } finally {
    db.release();
  }
  await new Promise((resolve) => setTimeout(resolve, 25 + Math.random() * 60));
  return transaction(fn, attempt + 1);
}
export function sqlDate(value: Date = new Date()) {
  return value.toISOString().slice(0, 23).replace("T", " ");
}
