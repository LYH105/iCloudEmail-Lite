import { config } from '../config.js';
import { getDb } from '../db/index.js';

export interface Overview {
  accounts: {
    total: number;
    active: number;
    needsAttention: number;
    withImap: number;
    paused: number;
  };
  aliases: {
    total: number;
    active: number;
    used: number;
    marked: number;
  };
  setup: {
    hasAccount: boolean;
    hasActiveAccount: boolean;
    hasMailbox: boolean;
  };
  jobs: {
    sessionRefreshMinutes: number;
    markScanMinutes: number;
  };
}

interface AccountCounts {
  total: number;
  active: number;
  needs_attention: number;
  with_imap: number;
  paused: number;
}

interface AliasCounts {
  total: number;
  active: number;
  used: number;
  marked: number;
}

/** A small, local-only dashboard snapshot; it never calls Apple or IMAP. */
export function getOverview(): Overview {
  const db = getDb();
  const accounts = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'active' AND disabled = 0 THEN 1 ELSE 0 END), 0) AS active,
              COALESCE(SUM(CASE WHEN status != 'active' AND disabled = 0 THEN 1 ELSE 0 END), 0) AS needs_attention,
              COALESCE(SUM(CASE WHEN EXISTS (
                SELECT 1 FROM imap_configs i WHERE i.account_id = accounts.id
              ) THEN 1 ELSE 0 END), 0) AS with_imap,
              COALESCE(SUM(CASE WHEN disabled = 1 THEN 1 ELSE 0 END), 0) AS paused
         FROM accounts`,
    )
    .get() as AccountCounts;
  const aliases = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END), 0) AS active,
              COALESCE(SUM(CASE WHEN used = 1 THEN 1 ELSE 0 END), 0) AS used,
              COALESCE(SUM(CASE WHEN EXISTS (
                SELECT 1 FROM alias_mark_hits h WHERE h.alias_id = aliases.id
              ) THEN 1 ELSE 0 END), 0) AS marked
         FROM aliases
        WHERE remote_present = 1`,
    )
    .get() as AliasCounts;

  return {
    accounts: {
      total: accounts.total,
      active: accounts.active,
      needsAttention: accounts.needs_attention,
      withImap: accounts.with_imap,
      paused: accounts.paused,
    },
    aliases,
    setup: {
      hasAccount: accounts.total > 0,
      hasActiveAccount: accounts.active > 0,
      hasMailbox: accounts.with_imap > 0,
    },
    jobs: {
      sessionRefreshMinutes: config.sessionRefreshMinutes,
      markScanMinutes: config.markScanMinutes,
    },
  };
}
