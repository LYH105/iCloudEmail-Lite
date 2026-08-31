import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { aliasesToCsv } from '../aliasCsv';
import { AliasLibraryToolbar } from '../features/aliases/AliasLibraryToolbar';
import { AliasList } from '../features/aliases/AliasList';
import { RulesSheet } from '../features/aliases/RulesSheet';
import { buildAliasLibraryModel } from '../features/aliases/libraryLogic';
import { useMarkRules } from '../features/aliases/useMarkRules';
import type { AccountPublic, AliasPublic, FetchedMessage } from '../types';
import {
  Button,
  EmailViewer,
  PageHeader,
  Sheet,
  errorMessage,
  formatDate,
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

  const [mailFor, setMailFor] = useState<AliasPublic | null>(null);
  const [mailMsgs, setMailMsgs] = useState<FetchedMessage[]>([]);
  const [mailLoading, setMailLoading] = useState(false);
  const [mailError, setMailError] = useState('');
  const [viewMsg, setViewMsg] = useState<FetchedMessage | null>(null);
  const mailRequestRef = useRef(0);
  const aliasRequestRef = useRef(0);
  const accountRequestRef = useRef(0);
  const [deleteFor, setDeleteFor] = useState<AliasPublic | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const refreshAliases = async () => {
    const requestId = ++aliasRequestRef.current;
    try {
      const result = await api.listAllAliases();
      if (requestId === aliasRequestRef.current) setAliases(result.aliases);
    } catch (e) {
      if (requestId === aliasRequestRef.current) toast.error(errorMessage(e));
    }
  };
  const markRules = useMarkRules(refreshAliases);
  const refreshAccounts = async () => {
    const requestId = ++accountRequestRef.current;
    try {
      const result = await api.listAccounts();
      if (requestId === accountRequestRef.current) setAccounts(result.accounts);
    } catch {
      // 状态刷新失败不打断主流程
    }
  };

  useEffect(() => {
    let active = true;
    const accountRequestId = ++accountRequestRef.current;
    const aliasRequestId = ++aliasRequestRef.current;
    void Promise.allSettled([api.listAccounts(), api.listAllAliases()]).then(
      ([accountResult, aliasResult]) => {
        if (!active) return;
        if (accountResult.status === 'fulfilled') {
          if (accountRequestId === accountRequestRef.current) {
            setAccounts(accountResult.value.accounts);
          }
        } else if (accountRequestId === accountRequestRef.current) {
          toast.error(errorMessage(accountResult.reason));
        }
        if (aliasResult.status === 'fulfilled') {
          if (aliasRequestId === aliasRequestRef.current) setAliases(aliasResult.value.aliases);
        } else if (aliasRequestId === aliasRequestRef.current) {
          toast.error(errorMessage(aliasResult.reason));
        }
        setLoading(false);
      },
    );
    void markRules.loadRules();
    return () => {
      active = false;
      aliasRequestRef.current += 1;
      accountRequestRef.current += 1;
      mailRequestRef.current += 1;
    };
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

  const openMail = async (a: AliasPublic) => {
    const requestId = ++mailRequestRef.current;
    setMailFor(a);
    setMailMsgs([]);
    setMailError('');
    setMailLoading(true);
    try {
      const r = await api.aliasMail(a.accountId, a.anonymousId, { sinceMinutes: 1440, limit: 5 });
      if (requestId !== mailRequestRef.current) return;
      setMailMsgs(r.messages);
      // Fetching mail already applies mark rules server-side — refresh so any
      // newly-hit mark (e.g. 已注册) shows up right away, no manual 扫描 needed.
      await refreshAliases();
    } catch (e) {
      if (requestId !== mailRequestRef.current) return;
      setMailError(errorMessage(e));
    } finally {
      if (requestId === mailRequestRef.current) setMailLoading(false);
    }
  };

  const closeMail = () => {
    mailRequestRef.current += 1;
    setMailFor(null);
    setViewMsg(null);
  };

  const deleteAlias = async () => {
    if (!deleteFor) return;
    setDeleteBusy(true);
    try {
      await api.deleteAlias(deleteFor.accountId, deleteFor.anonymousId);
      toast.ok('已删除隐藏邮箱');
      setDeleteFor(null);
      await refreshAliases();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setDeleteBusy(false);
    }
  };

  const { imapAccounts, pool, markOptions, enabledMarks, shown, totalActive } = buildAliasLibraryModel(
    accounts,
    aliases,
    markRules.rules,
    {
      accountId: accountFilter,
      mark: markFilter,
      query,
    },
  );

  const clearFilters = () => {
    setMarkFilter('');
    setAccountFilter('');
    setQuery('');
  };

  const exportShown = () => {
    if (shown.length === 0) return;
    const blob = new Blob([aliasesToCsv(shown, accounts)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `icloud-aliases-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    toast.ok(`已导出当前筛选的 ${shown.length} 个邮箱`);
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
            <Button variant="gray" size="sm" onClick={markRules.openSheet}>
              规则
            </Button>
            <Button variant="gray" size="sm" onClick={exportShown} disabled={shown.length === 0}>
              导出 CSV
            </Button>
          </>
        }
      />

      <AliasLibraryToolbar
        accountFilter={accountFilter}
        query={query}
        markFilter={markFilter}
        imapAccounts={imapAccounts}
        poolCount={pool.length}
        shownCount={shown.length}
        totalActive={totalActive}
        markOptions={markOptions}
        enabledMarks={enabledMarks}
        onAccountFilter={setAccountFilter}
        onQuery={setQuery}
        onMarkFilter={setMarkFilter}
      />

      <AliasList
        loading={loading}
        imapAccounts={imapAccounts}
        pool={pool}
        shown={shown}
        enabledMarks={enabledMarks}
        onClearFilters={clearFilters}
        onCopy={(text) => void copy(text)}
        onFilterMark={setMarkFilter}
        onToggleUsed={(alias) => void toggleUsed(alias)}
        onOpenMail={(alias) => void openMail(alias)}
        onDeleteRequest={setDeleteFor}
      />

      {deleteFor && (
        <Sheet
          title="删除隐藏邮箱"
          footer={
            <>
              <Button
                variant="gray"
                className="flex-1"
                onClick={() => setDeleteFor(null)}
                disabled={deleteBusy}
              >
                取消
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => void deleteAlias()}
                disabled={deleteBusy}
              >
                {deleteBusy ? '删除中…' : '确认删除'}
              </Button>
            </>
          }
        >
          <p className="muted text-[14px] text-center leading-relaxed">
            确定删除 <span className="mono break-all">{deleteFor.hme}</span>？
            <br />
            此操作会同步到 Apple，且无法从本应用撤销。
          </p>
        </Sheet>
      )}

      <RulesSheet controller={markRules} />

      {mailFor && (
        <Sheet
          title="别名收件"
          footer={
            <>
              <Button variant="gray" className="flex-1" onClick={closeMail}>
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
                      <Button size="sm" className="ml-auto flex-none" onClick={() => void copy(code.code)}>
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
