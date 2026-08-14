import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { api } from '../api';
import type {
  AccountPublic,
  AliasPublic,
  FetchedMessage,
  MarkRule,
  MarkRuleExport,
  OrphanMark,
} from '../types';
import {
  Badge,
  Button,
  EmailViewer,
  Field,
  PageHeader,
  Sheet,
  Switch,
  errorMessage,
  formatDate,
  formatRelative,
  pickCodeOrLink,
  useToast,
} from '../ui';

/**
 * 邮箱库: a cross-account pool of every alias belonging to an account whose
 * mailbox (IMAP) is connected. New aliases come from the 账户 page's
 * per-account auto-create; the pool itself refreshes automatically in the
 * background (aliasSyncScheduler / markScanner) — this page is a read +
 * light-action (used/收件/删除) view, not a generator.
 */
export function EmailLibraryPage() {
  const toast = useToast();
  const [accounts, setAccounts] = useState<AccountPublic[]>([]);
  const [aliases, setAliases] = useState<AliasPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [accountFilter, setAccountFilter] = useState(''); // '' = every IMAP-connected account
  const [query, setQuery] = useState('');
  const [markFilter, setMarkFilter] = useState(''); // '' = all, '__none__' = unmarked
  const [syncing, setSyncing] = useState(false);
  const [scanning, setScanning] = useState(false);

  const [rulesOpen, setRulesOpen] = useState(false);
  const [rules, setRules] = useState<MarkRule[]>([]);
  const [ruleEditId, setRuleEditId] = useState<string | null>(null);
  const [ruleMark, setRuleMark] = useState('');
  const [ruleFrom, setRuleFrom] = useState('');
  const [ruleSubject, setRuleSubject] = useState('');
  const [ruleBody, setRuleBody] = useState('');
  const [ruleBusy, setRuleBusy] = useState(false);
  const ruleFileRef = useRef<HTMLInputElement | null>(null);
  // Marks stranded on aliases by a rule that was renamed or deleted.
  const [orphans, setOrphans] = useState<OrphanMark[]>([]);
  const [orphanTarget, setOrphanTarget] = useState<Record<string, string>>({});
  const [orphanBusy, setOrphanBusy] = useState<string | null>(null);
  const [orphanConfirm, setOrphanConfirm] = useState<string | null>(null);

  const [mailFor, setMailFor] = useState<AliasPublic | null>(null);
  const [mailMsgs, setMailMsgs] = useState<FetchedMessage[]>([]);
  const [mailLoading, setMailLoading] = useState(false);
  const [mailError, setMailError] = useState('');
  const [viewMsg, setViewMsg] = useState<FetchedMessage | null>(null);

  const refreshAliases = async () => {
    try {
      setAliases((await api.listAllAliases()).aliases);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const refreshAccounts = async () => {
    try {
      setAccounts((await api.listAccounts()).accounts);
    } catch {
      // 状态刷新失败不打断主流程
    }
  };

  useEffect(() => {
    Promise.all([api.listAccounts(), api.listAllAliases()])
      .then(([accRes, aliasRes]) => {
        setAccounts(accRes.accounts);
        setAliases(aliasRes.aliases);
      })
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => setLoading(false));
    void loadRules();
  }, []);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.ok(ok);
      await refreshAliases();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.ok('已复制到剪贴板');
    } catch {
      toast.error('复制失败');
    }
  };

  const toggleUsed = (a: AliasPublic) =>
    act(
      () => api.setAliasUsed(a.accountId, a.anonymousId, !a.used),
      a.used ? '已取消使用标记' : '已标记为使用',
    );

  // Manual override for the automatic background sync/scan (both already run
  // every 30 min on their own) — handy right after setting something up.
  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await api.syncAllAliases();
      toast.ok(`已同步 ${r.synced} 个账户${r.errors.length ? `，${r.errors.length} 个失败` : ''}`);
      await refreshAliases();
      await refreshAccounts();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSyncing(false);
    }
  };

  const scanNow = async () => {
    setScanning(true);
    try {
      const r = await api.scanAllMarks();
      toast.ok(`已扫描 ${r.scanned} 封邮件 · 更新 ${r.updated.length} 个标记`);
      await refreshAliases();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setScanning(false);
    }
  };

  // ---- mark rules ----
  const loadRules = async () => {
    try {
      setRules((await api.listMarkRules()).rules);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const exportRules = async () => {
    try {
      const { rules: exported } = await api.exportMarkRules();
      const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mark-rules-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const importRulesFile = async (file: File | null) => {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const list = Array.isArray(parsed) ? parsed : (parsed as { rules?: unknown }).rules;
      if (!Array.isArray(list)) throw new Error('文件格式不正确：需要规则数组');
      const r = await api.importMarkRules(list as MarkRuleExport[]);
      toast.ok(`已导入 ${r.imported} 条规则${r.skipped ? `，跳过 ${r.skipped} 条（重复或无效）` : ''}`);
      await loadRules();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const loadOrphans = async () => {
    try {
      setOrphans((await api.listOrphanMarks()).orphans);
    } catch {
      // 整理区不可用不应挡住规则本身的编辑
    }
  };
  const resetRuleForm = () => {
    setRuleEditId(null);
    setRuleMark('');
    setRuleFrom('');
    setRuleSubject('');
    setRuleBody('');
  };
  const openRules = () => {
    setRulesOpen(true);
    resetRuleForm();
    setOrphanConfirm(null);
    void loadRules();
    void loadOrphans();
  };

  /**
   * The rule that most likely replaced this stranded mark: exactly one current
   * rule name containing it (已注册 → 某站已注册). Ambiguous or no match means
   * no preselection — picking wrong would move hundreds of marks to the wrong
   * badge, so that call stays with the user.
   */
  const ruleMarkNames = Array.from(new Set(rules.map((r) => r.mark)));
  const suggestTarget = (mark: string): string => {
    const lower = mark.toLowerCase();
    const hits = Array.from(new Set(rules.map((r) => r.mark))).filter(
      (m) => m !== mark && m.toLowerCase().includes(lower),
    );
    return hits.length === 1 ? hits[0]! : '';
  };
  const mergeOrphan = async (o: OrphanMark) => {
    const to = orphanTarget[o.mark] ?? suggestTarget(o.mark);
    if (!to) {
      toast.error('请选择要合并到哪个标记');
      return;
    }
    setOrphanBusy(o.mark);
    try {
      const r = await api.renameMark(o.mark, to);
      toast.ok(`已把 ${r.renamed} 个别名的「${o.mark}」并入「${to}」`);
      await Promise.all([loadOrphans(), refreshAliases()]);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setOrphanBusy(null);
    }
  };
  const clearOrphan = async (o: OrphanMark) => {
    setOrphanBusy(o.mark);
    try {
      const r = await api.clearMark(o.mark);
      toast.ok(`已从 ${r.cleared} 个别名上清除「${o.mark}」`);
      setOrphanConfirm(null);
      await Promise.all([loadOrphans(), refreshAliases()]);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setOrphanBusy(null);
    }
  };
  const editRule = (r: MarkRule) => {
    setRuleEditId(r.id);
    setRuleMark(r.mark);
    setRuleFrom(r.fromContains ?? '');
    setRuleSubject(r.subjectContains ?? '');
    setRuleBody(r.bodyContains ?? '');
  };
  const saveRule = async () => {
    const data = {
      mark: ruleMark.trim(),
      fromContains: ruleFrom.trim() || null,
      subjectContains: ruleSubject.trim() || null,
      bodyContains: ruleBody.trim() || null,
    };
    if (!data.mark) {
      toast.error('请填写标记名');
      return;
    }
    if (!data.fromContains && !data.subjectContains && !data.bodyContains) {
      toast.error('至少填写一个匹配条件（发件人/主题/正文）');
      return;
    }
    setRuleBusy(true);
    try {
      if (ruleEditId) {
        const existing = rules.find((r) => r.id === ruleEditId);
        await api.updateMarkRule(ruleEditId, { ...data, enabled: existing?.enabled ?? true });
      } else {
        await api.createMarkRule(data);
      }
      toast.ok('已保存规则');
      resetRuleForm();
      await Promise.all([loadRules(), loadOrphans(), refreshAliases()]);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRuleBusy(false);
    }
  };
  const toggleRule = async (r: MarkRule) => {
    try {
      await api.updateMarkRule(r.id, {
        mark: r.mark,
        fromContains: r.fromContains,
        subjectContains: r.subjectContains,
        bodyContains: r.bodyContains,
        enabled: !r.enabled,
      });
      await loadRules();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const removeRule = async (r: MarkRule) => {
    try {
      await api.deleteMarkRule(r.id);
      toast.ok('已删除规则');
      if (ruleEditId === r.id) resetRuleForm();
      await Promise.all([loadRules(), loadOrphans()]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const openMail = async (a: AliasPublic) => {
    setMailFor(a);
    setMailMsgs([]);
    setMailError('');
    setMailLoading(true);
    try {
      const r = await api.aliasMail(a.accountId, a.anonymousId, { sinceMinutes: 1440, limit: 5 });
      setMailMsgs(r.messages);
      // Fetching mail already applies mark rules server-side — refresh so any
      // newly-hit mark (e.g. 已注册) shows up right away, no manual 扫描 needed.
      await refreshAliases();
    } catch (e) {
      setMailError(errorMessage(e));
    } finally {
      setMailLoading(false);
    }
  };

  // ---- derived: the pool is every alias whose account has IMAP connected ----
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const imapAccounts = accounts.filter((a) => a.hasImap && !a.disabled);
  const imapAccountIds = new Set(imapAccounts.map((a) => a.id));
  const pool = aliases.filter((a) => imapAccountIds.has(a.accountId));

  const markOptions = Array.from(new Set(pool.flatMap((a) => a.marks.map((m) => m.mark))));
  // Marks every currently-enabled rule would produce, in rule-creation order
  // (registration → activation, …) — an alias that has achieved all of them
  // (not just the newest) is fully qualified ("可用").
  const enabledMarks = Array.from(new Set(rules.filter((r) => r.enabled).map((r) => r.mark)));
  const isComplete = (a: AliasPublic) =>
    enabledMarks.length > 0 && enabledMarks.every((m) => a.marks.some((h) => h.mark === m));
  // The furthest stage this alias has reached, and when it got there. Not a
  // raw max(hitAt): an earlier-stage mark (e.g. "已注册" from a login-link
  // email) can keep re-matching and drift its own timestamp forward long
  // after a later stage (e.g. "已开通") was reached, which would otherwise
  // make the summary time look newer than it really is.
  const latestHitAt = (a: AliasPublic) => {
    for (let i = enabledMarks.length - 1; i >= 0; i--) {
      const hit = a.marks.find((m) => m.mark === enabledMarks[i]);
      if (hit) return hit.hitAt;
    }
    // Marks not covered by any currently-enabled rule (e.g. rule since deleted).
    return a.marks.length ? Math.max(...a.marks.map((m) => m.hitAt)) : null;
  };
  const COMPLETE_FILTER = '__complete__';

  // Search across address / label / note / account (case-insensitive). Sort
  // order follows the current mark filter: a specific mark (or "可用") sorts
  // by when that mark was hit (newest first); otherwise by creation time.
  const q = query.trim().toLowerCase();
  const shown = pool
    .filter((a) => !accountFilter || a.accountId === accountFilter)
    .filter((a) => {
      if (!markFilter) return true;
      if (markFilter === COMPLETE_FILTER) return isComplete(a);
      if (markFilter === '__none__') return a.marks.length === 0;
      return a.marks.some((m) => m.mark === markFilter);
    })
    .filter((a) => {
      if (!q) return true;
      const accountId = (accountById.get(a.accountId)?.id ?? '').toLowerCase();
      return (
        a.hme.toLowerCase().includes(q) ||
        (a.label ?? '').toLowerCase().includes(q) ||
        (a.note ?? '').toLowerCase().includes(q) ||
        a.marks.some((m) => m.mark.toLowerCase().includes(q)) ||
        accountId.includes(q)
      );
    })
    .sort((a, b) => {
      if (markFilter === COMPLETE_FILTER) return (latestHitAt(b) ?? 0) - (latestHitAt(a) ?? 0);
      if (markFilter && markFilter !== '__none__') {
        const at = a.marks.find((m) => m.mark === markFilter)?.hitAt ?? 0;
        const bt = b.marks.find((m) => m.mark === markFilter)?.hitAt ?? 0;
        return bt - at;
      }
      return (
        (b.createTimestamp ?? Number.MAX_SAFE_INTEGER) - (a.createTimestamp ?? Number.MAX_SAFE_INTEGER)
      );
    });
  const totalActive = pool.filter((a) => a.isActive).length;

  const clearFilters = () => {
    setMarkFilter('');
    setAccountFilter('');
    setQuery('');
  };

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <PageHeader
        title="邮箱库"
        description="汇总所有已连接邮箱账户的别名。后台每 30 分钟自动从 Apple 同步、自动扫描邮箱打标记；新别名由「账户」页的定时创建自动补充。"
        actions={
          <>
            <Button variant="tinted" size="sm" onClick={syncNow} disabled={syncing}>
              {syncing ? '同步中…' : '同步'}
            </Button>
            <Button variant="tinted" size="sm" onClick={scanNow} disabled={scanning}>
              {scanning ? '扫描中…' : '扫描邮箱'}
            </Button>
            <Button variant="gray" size="sm" onClick={openRules}>
              规则
            </Button>
          </>
        }
      />

      {pool.length > 0 && (
        <div className="card px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="muted text-[13px] whitespace-nowrap">
            {imapAccounts.length} 个已连邮箱账户
          </span>
          <div className="flex-1" />
          <span className="muted text-[12px] whitespace-nowrap">
            共 {pool.length} · 启用 {totalActive} · 停用 {pool.length - totalActive}
          </span>
        </div>
      )}

      {/* ---- list toolbar: title · account filter · search · mark filter ---- */}
      <div className="flex items-center gap-3 px-1 flex-wrap">
        <h3 className="text-[15px] font-bold whitespace-nowrap">
          {shown.length}
          {shown.length !== pool.length && (
            <span className="subtle text-[12px] font-normal"> / {pool.length}</span>
          )}
        </h3>
        {imapAccounts.length > 1 && (
          <select
            className="input input-sm"
            style={{ width: 'auto', flex: 'none' }}
            title="按账户筛选"
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
          >
            <option value="">全部账户</option>
            {imapAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.appleId ?? a.id}
              </option>
            ))}
          </select>
        )}
        <input
          className="input input-sm"
          style={{ width: 'auto', flex: '0 1 280px' }}
          type="search"
          placeholder="搜索地址 / 标签 / 备注 / 标记 / 账户…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {(markOptions.length > 0 || markFilter) && (
          <select
            className="input input-sm"
            style={{ width: 'auto', flex: 'none' }}
            title="按标记筛选"
            value={markFilter}
            onChange={(e) => setMarkFilter(e.target.value)}
          >
            <option value="">全部标记（按创建时间）</option>
            {enabledMarks.length > 0 && <option value={COMPLETE_FILTER}>可用（按命中时间）</option>}
            {markOptions.map((m) => (
              <option key={m} value={m}>
                {m}（按命中时间）
              </option>
            ))}
            <option value="__none__">未标记</option>
          </select>
        )}
      </div>

      {/* ---- list (fills the rest of the page, scrolls internally) ---- */}
      {loading ? (
        <p className="muted">加载中…</p>
      ) : imapAccounts.length === 0 ? (
        <div className="card p-10 text-center muted">
          还没有已连接邮箱的账户 · 去「账户」页给账户设置 App 专用密码后，这里会自动汇总它的别名
        </div>
      ) : pool.length === 0 ? (
        <div className="card p-10 text-center muted">
          暂无别名 · 去「账户」页打开定时创建会自动生成，也可点上方「同步」立即从 Apple 拉取现有别名
        </div>
      ) : shown.length === 0 ? (
        <div className="card p-10 text-center muted">
          没有匹配的别名
          <Button variant="plain" size="sm" onClick={clearFilters}>
            清除筛选
          </Button>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto rounded-[18px]">
          <div className="list">
            {shown.map((a) => {
              const complete = isComplete(a);
              const hitAt = latestHitAt(a);
              const rowStyle: CSSProperties = { padding: '10px 16px' };
              if (complete) {
                rowStyle.background = 'color-mix(in srgb, var(--green) 12%, transparent)';
              }
              return (
                <div key={a.id} className="list-row" style={rowStyle}>
                  <div className="flex-1 min-w-0">
                    <button
                      className="mono font-semibold truncate text-left hover:opacity-70 block max-w-full text-[14px]"
                      style={{
                        color: 'var(--accent)',
                        opacity: a.isActive ? 1 : 0.45,
                        textDecoration: a.used ? 'line-through' : 'none',
                      }}
                      onClick={() => copy(a.hme)}
                      title="点击复制"
                    >
                      {a.hme}
                    </button>
                    <div className="subtle text-[11px] truncate mt-0.5">
                      创建于 {formatDate(a.createTimestamp)}
                    </div>
                    {a.marks.length > 0 && (
                      <div className="muted text-[12px] truncate flex items-center gap-1.5 mt-0.5">
                        {a.marks.map((m) => (
                          <button
                            key={m.mark}
                            className="cursor-pointer hover:opacity-75"
                            title={`${m.source ?? ''} · ${formatDate(m.hitAt)}（点击筛选该标记）`}
                            onClick={() => setMarkFilter(m.mark)}
                          >
                            <Badge tone="green">{m.mark}</Badge>
                          </button>
                        ))}
                        {hitAt && (
                          <span
                            className="whitespace-nowrap font-semibold"
                            style={{ color: 'var(--green)' }}
                            title={formatDate(hitAt)}
                          >
                            ✓ {formatRelative(hitAt)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <label className="flex flex-col items-center gap-0.5" title="标记为已使用后邮箱地址加删除线">
                    <span className="subtle text-[10px]">已用</span>
                    <Switch size="sm" checked={a.used} onChange={() => void toggleUsed(a)} />
                  </label>
                  <div className="flex gap-1.5">
                    {a.isActive && (
                      <Button variant="tinted" size="sm" onClick={() => openMail(a)}>
                        收件
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => void act(() => api.deleteAlias(a.accountId, a.anonymousId), '已删除')}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {rulesOpen && (
        <Sheet
          title="标记规则"
          footer={
            <>
              <Button variant="gray" className="flex-1" onClick={() => setRulesOpen(false)}>
                关闭
              </Button>
              <Button className="flex-1" onClick={saveRule} disabled={ruleBusy}>
                {ruleBusy ? '保存中…' : ruleEditId ? '保存修改' : '添加规则'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="muted text-[13px] leading-relaxed -mt-1">
              收到匹配的邮件时自动给别名打标记（如「已注册」「已开通」），标记会累加保留，不会互相覆盖。
              填写的条件需同时满足；每个条件可用 <span className="mono">|</span> 分隔多个关键词（任一命中）。
              当一个别名集齐了所有已启用的标记，整行会变绿表示可用。后台每半小时自动扫一轮。
            </p>
            <div className="flex gap-2">
              <Button variant="gray" size="sm" onClick={exportRules} disabled={rules.length === 0}>
                导出规则
              </Button>
              <Button variant="gray" size="sm" onClick={() => ruleFileRef.current?.click()}>
                导入规则
              </Button>
              <input
                ref={ruleFileRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  void importRulesFile(e.target.files?.[0] ?? null);
                  e.target.value = '';
                }}
              />
            </div>
            {rules.length > 0 && (
              <div className="list">
                {rules.map((r) => (
                  <div key={r.id} className="list-row" style={{ padding: '9px 12px' }}>
                    <div className="flex-1 min-w-0">
                      <Badge tone={r.enabled ? 'green' : 'gray'}>{r.mark}</Badge>
                      <div className="subtle text-[11px] truncate mt-1">
                        {[
                          r.fromContains && `发件人含「${r.fromContains}」`,
                          r.subjectContains && `主题含「${r.subjectContains}」`,
                          r.bodyContains && `正文含「${r.bodyContains}」`,
                        ]
                          .filter(Boolean)
                          .join(' 且 ')}
                      </div>
                    </div>
                    <Switch size="sm" checked={r.enabled} onChange={() => void toggleRule(r)} />
                    <Button variant="gray" size="sm" onClick={() => editRule(r)}>
                      编辑
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => void removeRule(r)}>
                      删
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {orphans.length > 0 && (
              <>
                <div className="hairline" />
                <div className="font-semibold text-[14px]">未被规则使用的标记</div>
                <p className="muted text-[12px] leading-relaxed -mt-1">
                  规则改名或删除前遗留在别名上的标记，不会再被打上，只会一直留着。把它并入现在的标记名，
                  或直接清除。（现在改规则名会自动带着已有标记一起改，不会再产生这种残留。）
                </p>
                <div className="list">
                  {orphans.map((o) => {
                    const target = orphanTarget[o.mark] ?? suggestTarget(o.mark);
                    const busy = orphanBusy === o.mark;
                    return (
                      <div key={o.mark} className="list-row" style={{ padding: '9px 12px' }}>
                        <div className="flex-1 min-w-0">
                          <Badge tone="amber">{o.mark}</Badge>
                          <div
                            className="subtle text-[11px] truncate mt-1"
                            title={`最近命中 ${formatDate(o.lastHitAt)}`}
                          >
                            {o.aliases} 个别名 · {formatRelative(o.lastHitAt)}
                          </div>
                        </div>
                        <select
                          className="input input-sm"
                          style={{ width: 'auto', flex: 'none', maxWidth: 150 }}
                          title="合并到哪个标记"
                          value={target}
                          onChange={(e) =>
                            setOrphanTarget((t) => ({ ...t, [o.mark]: e.target.value }))
                          }
                        >
                          <option value="">合并到…</option>
                          {ruleMarkNames.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                        <Button
                          variant="gray"
                          size="sm"
                          disabled={busy || !target}
                          onClick={() => void mergeOrphan(o)}
                        >
                          合并
                        </Button>
                        {orphanConfirm === o.mark ? (
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={busy}
                            onClick={() => void clearOrphan(o)}
                          >
                            {busy ? '清除中…' : `确认清除 ${o.aliases} 个`}
                          </Button>
                        ) : (
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => setOrphanConfirm(o.mark)}
                          >
                            清除
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <div className="hairline" />
            <div className="font-semibold text-[14px]">{ruleEditId ? '编辑规则' : '新增规则'}</div>
            <Field label="标记名（如：已注册 / 已开通）">
              <input className="input" value={ruleMark} onChange={(e) => setRuleMark(e.target.value)} />
            </Field>
            <Field label="发件人包含（可选，| 分隔多关键词）">
              <input
                className="input"
                value={ruleFrom}
                placeholder="如 noreply@example.com|support"
                onChange={(e) => setRuleFrom(e.target.value)}
              />
            </Field>
            <Field label="主题包含（可选）">
              <input
                className="input"
                value={ruleSubject}
                placeholder="如 注册成功|欢迎|verify"
                onChange={(e) => setRuleSubject(e.target.value)}
              />
            </Field>
            <Field label="正文包含（可选）">
              <input className="input" value={ruleBody} onChange={(e) => setRuleBody(e.target.value)} />
            </Field>
            {ruleEditId && (
              <Button variant="plain" size="sm" onClick={resetRuleForm}>
                取消编辑，改为新增
              </Button>
            )}
          </div>
        </Sheet>
      )}

      {mailFor && (
        <Sheet
          title="别名收件"
          footer={
            <>
              <Button variant="gray" className="flex-1" onClick={() => setMailFor(null)}>
                关闭
              </Button>
              <Button className="flex-1" onClick={() => openMail(mailFor)} disabled={mailLoading}>
                {mailLoading ? '拉取中…' : '刷新'}
              </Button>
            </>
          }
        >
          <div className="mono text-[13px] mb-3 break-all" style={{ color: 'var(--accent)' }}>
            {mailFor.hme}
          </div>
          {mailLoading && <p className="muted text-center py-4">拉取中…</p>}
          {mailError && (
            <p className="text-center py-3 text-[13px]" style={{ color: 'var(--amber)' }}>
              {mailError}
            </p>
          )}
          {!mailLoading && !mailError && mailMsgs.length === 0 && (
            <p className="muted text-center py-4 text-[13px]">最近 24 小时内没有发往该别名的邮件。</p>
          )}
          <div className="flex flex-col gap-2">
            {mailMsgs.map((m) => {
              // Only surface a code/link when confident it's really that kind of
              // email; a normal email (or a weak false positive) shows neither.
              const { code, link } = pickCodeOrLink(m);
              return (
                <div key={m.uid} className="list p-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold truncate flex-1">{m.subject || '(无主题)'}</span>
                    <button
                      className="muted text-[12px] whitespace-nowrap hover:opacity-70 flex-none"
                      onClick={() => setViewMsg(m)}
                    >
                      查看原文 ›
                    </button>
                  </div>
                  {code && (
                    <div
                      className="flex items-center gap-2 rounded-xl px-3 py-2"
                      style={{ background: 'var(--surface-2)' }}
                    >
                      <span className="muted text-[12px] flex-none">验证码</span>
                      <span
                        className="mono font-bold text-[20px] tracking-widest truncate"
                        style={{ color: 'var(--accent)' }}
                      >
                        {code.code}
                      </span>
                      <Button
                        size="sm"
                        className="ml-auto flex-none"
                        onClick={() => void copy(code.code)}
                      >
                        复制验证码
                      </Button>
                    </div>
                  )}
                  {link && (
                    <div
                      className="flex items-center gap-2 rounded-xl px-3 py-2"
                      style={{ background: 'var(--surface-2)' }}
                    >
                      <span className="flex-none">🔗</span>
                      <span
                        className="truncate text-[13px] flex-1"
                        style={{ color: 'var(--accent)' }}
                        title={link.url}
                      >
                        {link.label || link.url}
                      </span>
                      <Button
                        size="sm"
                        variant="tinted"
                        className="ml-auto flex-none"
                        onClick={() => void copy(link.url)}
                      >
                        复制链接
                      </Button>
                    </div>
                  )}
                  <div className="muted text-[12px] truncate">
                    {m.from} · {formatDate(m.date)}
                  </div>
                </div>
              );
            })}
          </div>
        </Sheet>
      )}

      {viewMsg && <EmailViewer message={viewMsg} onClose={() => setViewMsg(null)} />}
    </div>
  );
}
