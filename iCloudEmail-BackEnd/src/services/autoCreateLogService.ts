import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';

export interface AutoCreateLogPublic {
  id: string;
  accountId: string;
  appleId: string | null;
  success: boolean;
  createdCount: number;
  errorCount: number;
  message: string | null;
  createdAt: number;
}

interface LogRow {
  id: string;
  account_id: string;
  apple_id: string | null;
  success: number;
  created_count: number;
  error_count: number;
  message: string | null;
  created_at: number;
}

function toPublic(row: LogRow): AutoCreateLogPublic {
  return {
    id: row.id,
    accountId: row.account_id,
    appleId: row.apple_id,
    success: row.success === 1,
    createdCount: row.created_count,
    errorCount: row.error_count,
    message: row.message,
    createdAt: row.created_at,
  };
}

/** Record one scheduled auto-create attempt (success or failure) for an account. */
export function logAutoCreateAttempt(
  accountId: string,
  success: boolean,
  createdCount: number,
  errorCount: number,
  message: string | null,
): void {
  getDb()
    .prepare(
      `INSERT INTO auto_create_logs (id, account_id, success, created_count, error_count, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), accountId, success ? 1 : 0, createdCount, errorCount, message, Date.now());
}

export function listAutoCreateLogs(limit = 50): AutoCreateLogPublic[] {
  const rows = getDb()
    .prepare(
      `SELECT l.*, a.apple_id AS apple_id
         FROM auto_create_logs l
         LEFT JOIN accounts a ON a.id = l.account_id
        ORDER BY l.created_at DESC
        LIMIT ?`,
    )
    .all(limit) as LogRow[];
  return rows.map(toPublic);
}
