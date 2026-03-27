import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";
import path from "path";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "storage", "grader.db");

const globalForDb = globalThis as unknown as { __db?: Database.Database };

const sqlite = globalForDb.__db ?? new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("busy_timeout = 5000");
sqlite.pragma("foreign_keys = ON");

if (process.env.NODE_ENV !== "production") {
  globalForDb.__db = sqlite;
}

export const db = drizzle(sqlite, { schema });
