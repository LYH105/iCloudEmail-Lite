import { getDb } from '../db/index.js';
import { logger } from '../logger.js';
import { fetchCodes, pickConfigForAccount } from './imapService.js';

export interface MarkRule {
  id: string;
  mark: string;
  fromContains: string | null;
  subjectContains: string | null;
  bodyContains: string | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

interface MarkRuleRow {
  id: string;
  mark: string;
  from_contains: string | null;
  subject_contains: string | null;
  body_contains: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
}

function toPublic(row: MarkRuleRow): MarkRule {
  return {
    id: row.id,
    mark: row.mark,
    fromContains: row.from_contains,
    subjectContains: row.subject_contains,
    bodyContains: row.body_contains,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listRules(): MarkRule[] {
  const rows = getDb()
    .prepare('SELECT * FROM mark_rules ORDER BY created_at')
    .all() as MarkRuleRow[];
  return rows.map(toPublic);
}

export interface MarkRuleInput {
  mark: string;
  fromContains?: string | null;
  subjectContains?: string | null;
  bodyContains?: string | null;
  enabled?: boolean;
}

const norm = (s?: string | null) => {
  const v = s?.trim();
  return v ? v : null;
};

function assertHasCondition(input: MarkRuleInput): void {
  if (!norm(input.fromContains) && !norm(input.subjectContains) && !norm(input.bodyContains)) {
    throw Object.assign(new Error('至少填写一个匹配条件（发件人/主题/正文）'), { status: 400 });
  }
}

export function createRule(input: MarkRuleInput): MarkRule {
  assertHasCondition(input);
  const id = crypto.randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO mark_rules (id, mark, from_contains, subject_contains, body_contains, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.mark.trim(),
      norm(input.fromContains),
      norm(input.subjectContains),
      norm(input.bodyContains),
      input.enabled === false ? 0 : 1,
      now,
      now,
    );
  return toPublic(getRuleRow(id)!);
}

export function updateRule(id: string, input: MarkRuleInput): MarkRule {
  const row = getRuleRow(id);
  if (!row) throw Object.assign(new Error('规则不存在'), { status: 404 });
  assertHasCondition(input);
  const mark = input.mark.trim();
  getDb()
    .prepare(
      `UPDATE mark_rules SET mark = ?, from_contains = ?, subject_contains = ?, body_contains = ?,
         enabled = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      mark,
      norm(input.fromContains),
      norm(input.subjectContains),
      norm(input.bodyContains),
      input.enabled === false ? 0 : 1,
      Date.now(),
      id,
    );
  // Hits are stored by mark *name*, so renaming a rule would otherwise strand
  // every mark it has already awarded: the old name would stay on the aliases
  // forever while the new one piles up next to it. Carry them over — but only
  // when no other rule still produces the old name, since hits don't record
  // which rule awarded them and those would not be ours to move.
  if (mark !== row.mark && !isMarkProducedByRule(row.mark)) {
    renameMark(row.mark, mark);
  }
  return toPublic(getRuleRow(id)!);
}

export function deleteRule(id: string): boolean {
  return getDb().prepare('DELETE FROM mark_rules WHERE id = ?').run(id).changes > 0;
}

/** Whether any rule (enabled or not) still awards this mark. */
function isMarkProducedByRule(mark: string): boolean {
  return !!getDb().prepare('SELECT 1 FROM mark_rules WHERE mark = ? LIMIT 1').get(mark);
}

/**
 * Move every hit of `from` onto `to`, merging where an alias already has both
 * (the later hit wins, so the badge keeps its most recent timestamp/source).
 * Returns how many aliases were affected.
 */
export function renameMark(from: string, to: string): number {
  const db = getDb();
  const target = to.trim();
  if (!target || target === from) return 0;
  const rows = db
    .prepare('SELECT alias_id, hit_at, source FROM alias_mark_hits WHERE mark = ?')
    .all(from) as { alias_id: string; hit_at: number; source: string | null }[];
  if (rows.length === 0) return 0;

  const upsert = db.prepare(
    `INSERT INTO alias_mark_hits (alias_id, mark, hit_at, source) VALUES (?, ?, ?, ?)
     ON CONFLICT(alias_id, mark) DO UPDATE SET
       source = CASE WHEN excluded.hit_at > alias_mark_hits.hit_at THEN excluded.source
                     ELSE alias_mark_hits.source END,
       hit_at = MAX(excluded.hit_at, alias_mark_hits.hit_at)`,
  );
  const del = db.prepare('DELETE FROM alias_mark_hits WHERE mark = ?');
  db.transaction(() => {
    for (const r of rows) upsert.run(r.alias_id, target, r.hit_at, r.source);
    del.run(from);
  })();
  logger.info(`[marks] renamed "${from}" → "${target}" on ${rows.length} aliases`);
  return rows.length;
}

/** Drop a mark from every alias that carries it. Returns how many were cleared. */
export function deleteMark(mark: string): number {
  const n = getDb().prepare('DELETE FROM alias_mark_hits WHERE mark = ?').run(mark).changes;
  if (n > 0) logger.info(`[marks] cleared "${mark}" from ${n} aliases`);
  return n;
}

export interface OrphanMark {
  mark: string;
  aliases: number;
  lastHitAt: number;
}

/**
 * Marks sitting on aliases that no rule produces any more — typically left
 * behind by a rule renamed before {@link updateRule} carried hits over, or by
 * a deleted rule. They can't be re-awarded, so they only ever go stale.
 */
export function listOrphanMarks(): OrphanMark[] {
  const rows = getDb()
    .prepare(
      `SELECT mark, COUNT(*) AS aliases, MAX(hit_at) AS last_hit_at
         FROM alias_mark_hits
        WHERE mark NOT IN (SELECT mark FROM mark_rules)
        GROUP BY mark
        ORDER BY aliases DESC`,
    )
    .all() as { mark: string; aliases: number; last_hit_at: number }[];
  return rows.map((r) => ({ mark: r.mark, aliases: r.aliases, lastHitAt: r.last_hit_at }));
}

/** Portable rule shape for export/import — no id/timestamps, so re-importing never collides on those. */
export interface MarkRuleExport {
  mark: string;
  fromContains: string | null;
  subjectContains: string | null;
  bodyContains: string | null;
  enabled: boolean;
}

export function exportRules(): MarkRuleExport[] {
  return listRules().map((r) => ({
    mark: r.mark,
    fromContains: r.fromContains,
    subjectContains: r.subjectContains,
    bodyContains: r.bodyContains,
    enabled: r.enabled,
  }));
}

function ruleKey(r: Pick<MarkRuleExport, 'mark' | 'fromContains' | 'subjectContains' | 'bodyContains'>): string {
  return [r.mark, r.fromContains ?? '', r.subjectContains ?? '', r.bodyContains ?? ''].join('\0');
}

export interface ImportResult {
  imported: number;
  skipped: number;
}

/** Loosely-typed input item — mirrors the API's validated-but-optional request shape. */
export interface MarkRuleImportItem {
  mark: string;
  fromContains?: string | null;
  subjectContains?: string | null;
  bodyContains?: string | null;
  enabled?: boolean;
}

/** Import rules, skipping ones that are invalid or already exist (same mark + conditions). */
export function importRules(input: MarkRuleImportItem[]): ImportResult {
  const seen = new Set(listRules().map(ruleKey));
  let imported = 0;
  let skipped = 0;
  for (const raw of input) {
    const mark = raw?.mark?.trim();
    const fromContains = norm(raw?.fromContains);
    const subjectContains = norm(raw?.subjectContains);
    const bodyContains = norm(raw?.bodyContains);
    if (!mark || (!fromContains && !subjectContains && !bodyContains)) {
      skipped++;
      continue;
    }
    const key = ruleKey({ mark, fromContains, subjectContains, bodyContains });
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    createRule({ mark, fromContains, subjectContains, bodyContains, enabled: raw.enabled !== false });
    seen.add(key);
    imported++;
  }
  return { imported, skipped };
}

function getRuleRow(id: string): MarkRuleRow | undefined {
  return getDb().prepare('SELECT * FROM mark_rules WHERE id = ?').get(id) as
    | MarkRuleRow
    | undefined;
}

/** "a|b|c" → any keyword contained (case-insensitive); empty field = pass. */
function fieldMatches(condition: string | null, haystack: string): boolean {
  if (!condition) return true;
  const keywords = condition
    .split('|')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  if (keywords.length === 0) return true;
  const lower = haystack.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

function ruleMatches(rule: MarkRuleRow, msg: { from: string; subject: string; body: string }): boolean {
  return (
    fieldMatches(rule.from_contains, msg.from) &&
    fieldMatches(rule.subject_contains, msg.subject) &&
    fieldMatches(rule.body_contains, msg.body)
  );
}

export interface AliasMarkHit {
  mark: string;
  hitAt: number;
  source: string | null;
}

interface HitRow {
  alias_id: string;
  mark: string;
  hit_at: number;
  source: string | null;
}

/** All achieved marks for every alias of an account, grouped by alias id. */
export function getHitsForAccount(accountId: string): Map<string, AliasMarkHit[]> {
  const rows = getDb()
    .prepare(
      `SELECT h.alias_id, h.mark, h.hit_at, h.source
         FROM alias_mark_hits h
         JOIN aliases a ON a.id = h.alias_id
        WHERE a.account_id = ?`,
    )
    .all(accountId) as HitRow[];
  const map = new Map<string, AliasMarkHit[]>();
  for (const r of rows) {
    const arr = map.get(r.alias_id) ?? [];
    arr.push({ mark: r.mark, hitAt: r.hit_at, source: r.source });
    map.set(r.alias_id, arr);
  }
  return map;
}

/** Achieved marks for a single alias. */
export function getHitsForAlias(aliasId: string): AliasMarkHit[] {
  const rows = getDb()
    .prepare('SELECT mark, hit_at, source FROM alias_mark_hits WHERE alias_id = ?')
    .all(aliasId) as Omit<HitRow, 'alias_id'>[];
  return rows.map((r) => ({ mark: r.mark, hitAt: r.hit_at, source: r.source }));
}

/** All achieved marks across every account, grouped by alias id. */
export function getAllHits(): Map<string, AliasMarkHit[]> {
  const rows = getDb().prepare('SELECT alias_id, mark, hit_at, source FROM alias_mark_hits').all() as HitRow[];
  const map = new Map<string, AliasMarkHit[]>();
  for (const r of rows) {
    const arr = map.get(r.alias_id) ?? [];
    arr.push({ mark: r.mark, hitAt: r.hit_at, source: r.source });
    map.set(r.alias_id, arr);
  }
  return map;
}

export interface ScanResult {
  scanned: number;
  updated: { hme: string; mark: string }[];
}

/**
 * Scan the account's inbox and mark aliases whose mail matches an enabled
 * rule. Marks accumulate: each matching message adds/refreshes the hit for
 * its rule's mark, so an alias that has received mail matching several
 * different rules ends up with all of those marks at once (rather than only
 * the newest one). A single message matching several rules still only
 * counts for the first enabled rule (creation order).
 */
export async function scanAccount(accountId: string, sinceMinutes = 10_080): Promise<ScanResult> {
  const db = getDb();
  const aliases = db
    .prepare('SELECT id, hme FROM aliases WHERE account_id = ?')
    .all(accountId) as { id: string; hme: string }[];
  if (aliases.length === 0) return { scanned: 0, updated: [] };

  const rules = db
    .prepare('SELECT * FROM mark_rules WHERE enabled = 1 ORDER BY created_at')
    .all() as MarkRuleRow[];
  if (rules.length === 0) return { scanned: 0, updated: [] };

  const configId = pickConfigForAccount(accountId);
  if (!configId) {
    throw Object.assign(
      new Error('该账户尚未设置收件邮箱：请到「账户」页在「编辑」里填入 App 专用密码'),
      { status: 409 },
    );
  }

  const messages = await fetchCodes(configId, {
    sinceMinutes,
    limit: 200,
    withHeaders: true,
    // Header-first prefilter: only mail addressed to one of our aliases has
    // its body downloaded at all.
    prefilterRecipients: aliases.map((a) => a.hme),
  });

  const existing = getHitsForAccount(accountId);
  // Oldest first, so the last message matching a given (alias, mark) pair
  // decides that mark's hit time/source.
  const ordered = [...messages].sort((a, b) => a.date.localeCompare(b.date));
  const pending = new Map<string, { mark: string; hitAt: number; source: string }>(); // key: `${aliasId}\0${mark}`

  for (const msg of ordered) {
    const recipientHaystack = `${msg.to}\n${msg.headers ?? ''}`.toLowerCase();
    const body = msg.text || msg.html || '';
    const rule = rules.find((r) => ruleMatches(r, { from: msg.from, subject: msg.subject, body }));
    if (!rule) continue;
    for (const alias of aliases) {
      if (!recipientHaystack.includes(alias.hme.toLowerCase())) continue;
      pending.set(`${alias.id}\0${rule.mark}`, {
        mark: rule.mark,
        hitAt: new Date(msg.date).getTime() || Date.now(),
        source: `${msg.from} · ${msg.subject || '(无主题)'}`.slice(0, 200),
      });
    }
  }

  const updated: { hme: string; mark: string }[] = [];
  const stmt = db.prepare(
    `INSERT INTO alias_mark_hits (alias_id, mark, hit_at, source) VALUES (?, ?, ?, ?)
     ON CONFLICT(alias_id, mark) DO UPDATE SET hit_at = excluded.hit_at, source = excluded.source`,
  );
  for (const [key, h] of pending) {
    const aliasId = key.slice(0, key.indexOf('\0'));
    stmt.run(aliasId, h.mark, h.hitAt, h.source);
    const alreadyHad = (existing.get(aliasId) ?? []).some((e) => e.mark === h.mark);
    if (!alreadyHad) {
      const alias = aliases.find((a) => a.id === aliasId)!;
      updated.push({ hme: alias.hme, mark: h.mark });
    }
  }
  logger.info(
    `[marks] account ${accountId}: scanned ${messages.length} messages, ${pending.size} matched, ${updated.length} newly achieved`,
  );
  return { scanned: messages.length, updated };
}

/**
 * Apply enabled rules to messages already fetched for one alias (e.g. from
 * the "收件" button), so a freshly-arrived registration/activation mail marks
 * its alias immediately instead of waiting for the next periodic scan.
 * Marks accumulate the same way {@link scanAccount} does. Returns every mark
 * touched (new or re-hit) — mainly for tests/inspection.
 */
export function applyRulesToAlias(
  aliasId: string,
  messages: { from: string; subject: string; text: string; html: string | null; date: string }[],
): AliasMarkHit[] {
  if (messages.length === 0) return [];
  const db = getDb();
  const rules = db
    .prepare('SELECT * FROM mark_rules WHERE enabled = 1 ORDER BY created_at')
    .all() as MarkRuleRow[];
  if (rules.length === 0) return [];

  // Oldest first, so the last message matching a given mark decides its hit time/source.
  const ordered = [...messages].sort((a, b) => a.date.localeCompare(b.date));
  const pending = new Map<string, { hitAt: number; source: string }>();
  for (const msg of ordered) {
    const body = msg.text || msg.html || '';
    const rule = rules.find((r) => ruleMatches(r, { from: msg.from, subject: msg.subject, body }));
    if (!rule) continue;
    pending.set(rule.mark, {
      hitAt: new Date(msg.date).getTime() || Date.now(),
      source: `${msg.from} · ${msg.subject || '(无主题)'}`.slice(0, 200),
    });
  }
  if (pending.size === 0) return [];

  const stmt = db.prepare(
    `INSERT INTO alias_mark_hits (alias_id, mark, hit_at, source) VALUES (?, ?, ?, ?)
     ON CONFLICT(alias_id, mark) DO UPDATE SET hit_at = excluded.hit_at, source = excluded.source`,
  );
  const applied: AliasMarkHit[] = [];
  for (const [mark, h] of pending) {
    stmt.run(aliasId, mark, h.hitAt, h.source);
    applied.push({ mark, hitAt: h.hitAt, source: h.source });
  }
  return applied;
}

/** Scan every account that has an IMAP mailbox connected, aggregating totals. */
export async function scanAllAccounts(): Promise<ScanResult> {
  const rows = getDb()
    .prepare(
      `SELECT id FROM accounts WHERE disabled = 0 AND EXISTS (SELECT 1 FROM imap_configs WHERE account_id = accounts.id)`,
    )
    .all() as { id: string }[];
  let scanned = 0;
  const updated: { hme: string; mark: string }[] = [];
  for (const row of rows) {
    try {
      const r = await scanAccount(row.id);
      scanned += r.scanned;
      updated.push(...r.updated);
    } catch (err) {
      logger.warn(`[marks] scan-all account ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { scanned, updated };
}
