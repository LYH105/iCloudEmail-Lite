import { useCallback, useEffect, useRef, useState } from 'react';
import { api, CLEAR_PRIVATE_CACHE_EVENT } from '../api';
import type { AccountPublic, LibraryMessage } from '../types';
import { mailMessageKey, mergeMailMessages } from '../features/mail/mailCacheLogic';
import { peekMailCache, readMailCache, writeMailCache } from '../features/mail/mailCacheStore';
import {
  Button,
  EmailViewer,
  PageHeader,
  Segmented,
  Switch,
  errorMessage,
  formatDate,
  formatRelative,
  pickCodeOrLink,
  useToast,
} from '../ui';

const WINDOWS = [
  { value: '1440', label: '24 小时' },
  { value: '4320', label: '3 天' },
  { value: '10080', label: '7 天' },
  { value: '43200', label: '30 天' },
] as const;

const DEFAULT_WINDOW = '1440';
const AUTO_REFRESH_MS = 30_000;
// Overlap added to an incremental pull so a message that arrived while the
// previous one was in flight can't slip through the gap.
const INCREMENTAL_OVERLAP_MINUTES = 3;

/**
 * Mail already pulled is kept in memory for instant tab switches and in
 * IndexedDB for application restarts. A full pull is a real IMAP round-trip
 * across every connected account, so returning to the tab only restores this
 * cache; refreshes merge in mail newer than the newest cached message.
 *
 * Keyed by time window; the selected window and the account labels are
 * remembered the same way.
 */
let lastWindow: string = DEFAULT_WINDOW;
let accountCache: AccountPublic[] = [];

if (typeof window !== 'undefined') {
  window.addEventListener(CLEAR_PRIVATE_CACHE_EVENT, () => {
    accountCache = [];
    lastWindow = DEFAULT_WINDOW;
  });
}

/**
 * 最近邮件: one aggregate inbox across every alias of every IMAP-connected
 * account (GET /api/aliases/mail-library). Each row is tagged with the alias
 * it reached and the account that alias belongs to, so a freshly-arrived
 * verification code can be grabbed without first hunting it down in 邮箱库.
 */
export function MailLibraryPage() {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [sinceMinutes, setSinceMinutes] = useState<string>(lastWindow);
  const [messages, setMessages] = useState<LibraryMessage[]>(() => peekMailCache(lastWindow)?.messages ?? []);
  const [accounts, setAccounts] = useState<AccountPublic[]>(accountCache);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(() => !peekMailCache(lastWindow));
  const [loadedAt, setLoadedAt] = useState<number | null>(() => peekMailCache(lastWindow)?.loadedAt ?? null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [onlyCodes, setOnlyCodes] = useState(false);
  const [auto, setAuto] = useState(false);
  const [viewMsg, setViewMsg] = useState<LibraryMessage | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  // Newest request wins: a slow reply for a window the user has already
  // switched away from must not land on top of what's on screen.
  const seqRef = useRef(0);
  const activeRequestRef = useRef<{ seq: number; controller: AbortController } | null>(null);

  /**
   * Pull mail for `minutes`. Incrementally by default: only the span since the
   * last successful pull is requested, and the result is merged into the local
   * cache. This remains efficient even when no mail arrived in that interval.
   * A window with nothing cached always pulls the whole span.
   */
  const load = useCallback(
    async (minutes: string, opts: { silent?: boolean; full?: boolean } = {}): Promise<void> => {
      if (opts.silent && activeRequestRef.current) return;
      if (!opts.silent && activeRequestRef.current) {
        activeRequestRef.current.controller.abort();
        activeRequestRef.current = null;
      }
      const cached = peekMailCache(minutes);
      const lastPulledAt = cached?.loadedAt ?? NaN;
      const span =
        opts.full || !Number.isFinite(lastPulledAt)
          ? Number(minutes)
          : Math.min(
              Number(minutes),
              Math.ceil((Date.now() - lastPulledAt) / 60_000) + INCREMENTAL_OVERLAP_MINUTES,
            );

      const seq = ++seqRef.current;
      const controller = new AbortController();
      activeRequestRef.current = { seq, controller };
      if (!opts.silent) setLoading(true);
      try {
        // Store the request's start time as the covered-through watermark. If
        // the IMAP round-trip takes a while, the next overlap safely covers it.
        const requestedAt = Date.now();
        const result = await api.mailLibrary(Math.max(1, span), { signal: controller.signal });
        const next = mergeMailMessages(cached?.messages ?? [], result.messages, Number(minutes), requestedAt);
        await writeMailCache(minutes, { messages: next, loadedAt: requestedAt });
        if (seq !== seqRef.current) return;
        setMessages(next);
        setLoadedAt(requestedAt);
        setError('');
      } catch (requestError) {
        if (controller.signal.aborted || seq !== seqRef.current) return;
        const message = errorMessage(requestError);
        setError(message);
        if (!opts.silent) toastRef.current.error(message);
      } finally {
        if (activeRequestRef.current?.seq === seq) activeRequestRef.current = null;
        if (!opts.silent && seq === seqRef.current) setLoading(false);
      }
    },
    [],
  );

  // Account labels for the per-row tag — cheap, local, and cached across mounts.
  useEffect(() => {
    if (accountCache.length > 0) return;
    let cancelled = false;
    api
      .listAccounts()
      .then((r) => {
        if (cancelled) return;
        accountCache = r.accounts;
        setAccounts(r.accounts);
      })
      .catch(() => {
        // Only affects the account tag; the mail list stands on its own.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Opening the tab (or switching window) restores the durable local cache
  // immediately, then silently fills only the gap since its last successful
  // pull. A window that has never been cached needs one initial full pull.
  useEffect(() => {
    lastWindow = sinceMinutes;
    if (activeRequestRef.current) {
      activeRequestRef.current.controller.abort();
      activeRequestRef.current = null;
    }
    // A refresh for the previous window may have owned the visible loading
    // flag. Reset it before the new window decides whether it needs a pull.
    setLoading(false);
    const memory = peekMailCache(sinceMinutes);
    setMessages(memory?.messages ?? []);
    setLoadedAt(memory?.loadedAt ?? null);
    setError('');
    setRestoring(!memory);

    const seq = ++seqRef.current;
    void readMailCache(sinceMinutes).then((hit) => {
      if (seq !== seqRef.current) return;
      setRestoring(false);
      if (hit) {
        setMessages(hit.messages);
        setLoadedAt(hit.loadedAt);
        void load(sinceMinutes, { silent: true });
        return;
      }
      void load(sinceMinutes);
    });
  }, [load, sinceMinutes]);

  useEffect(
    () => () => {
      seqRef.current += 1;
      activeRequestRef.current?.controller.abort();
      activeRequestRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const clearVisibleState = () => {
      seqRef.current += 1;
      activeRequestRef.current?.controller.abort();
      activeRequestRef.current = null;
      setLoading(false);
      setRestoring(false);
      setMessages([]);
      setAccounts([]);
      setLoadedAt(null);
      setError('');
      setViewMsg(null);
    };
    window.addEventListener(CLEAR_PRIVATE_CACHE_EVENT, clearVisibleState);
    return () => window.removeEventListener(CLEAR_PRIVATE_CACHE_EVENT, clearVisibleState);
  }, []);

  useEffect(() => {
    if (!auto) return;
    const refreshIfVisible = () => {
      const pageVisible = Boolean(pageRef.current?.getClientRects().length);
      if (document.visibilityState === 'visible' && pageVisible) {
        void load(sinceMinutes, { silent: true });
      }
    };
    const timer = setInterval(refreshIfVisible, AUTO_REFRESH_MS);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [auto, load, sinceMinutes]);

  // Keep "更新于 X 分钟前" truthful while the tab sits open — it's the only
  // signal that what's on screen came from the cache rather than a fresh pull.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!loadedAt) return;
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [loadedAt]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.ok('已复制到剪贴板');
    } catch {
      toast.error('复制失败');
    }
  };

  const accountLabel = (accountId: string): string => {
    const a = accounts.find((x) => x.id === accountId);
    return a?.appleId ?? a?.label ?? accountId.slice(0, 8);
  };

  const q = query.trim().toLowerCase();
  const shown = messages.filter((m) => {
    if (onlyCodes) {
      const { code, link } = pickCodeOrLink(m);
      if (!code && !link) return false;
    }
    if (!q) return true;
    return (
      m.alias.toLowerCase().includes(q) ||
      m.from.toLowerCase().includes(q) ||
      m.subject.toLowerCase().includes(q) ||
      accountLabel(m.accountId).toLowerCase().includes(q)
    );
  });

  return (
    <div ref={pageRef} className="flex flex-col gap-4 h-full min-h-0">
      <PageHeader
        title="最近邮件"
        description="汇总所有已连接邮箱账户、所有别名收到的邮件，按时间倒序；每封标注收件别名与所属账户，验证码与登录链接可直接复制。邮件会持久缓存到本机，再次打开或刷新时只补齐上次拉取之后的新邮件。"
        actions={
          <>
            <Segmented
              options={WINDOWS.map((w) => ({ value: w.value, label: w.label }))}
              value={sinceMinutes}
              onChange={setSinceMinutes}
            />
            <Button variant="tinted" size="sm" onClick={() => void load(sinceMinutes)} disabled={loading}>
              {loading ? '拉取中…' : '刷新'}
            </Button>
          </>
        }
      />

      {/* ---- toolbar: count · search · filters · auto-refresh ---- */}
      <div className="flex items-center gap-3 px-1 flex-wrap">
        <h3 className="text-[15px] font-bold whitespace-nowrap">
          {shown.length}
          {shown.length !== messages.length && (
            <span className="subtle text-[12px] font-normal"> / {messages.length}</span>
          )}
        </h3>
        <input
          className="input input-sm"
          style={{ width: 'auto', flex: '0 1 280px' }}
          type="search"
          placeholder="搜索别名 / 账户 / 发件人 / 主题…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="flex items-center gap-1.5" title="只显示识别出验证码或登录链接的邮件">
          <span className="subtle text-[12px] whitespace-nowrap">只看验证码/链接</span>
          <Switch
            size="sm"
            checked={onlyCodes}
            onChange={() => setOnlyCodes(!onlyCodes)}
            label="只显示验证码或登录链接"
          />
        </label>
        <label className="flex items-center gap-1.5" title="每 30 秒自动取一次新邮件">
          <span className="subtle text-[12px] whitespace-nowrap">自动刷新</span>
          <Switch size="sm" checked={auto} onChange={() => setAuto(!auto)} label="每 30 秒自动刷新邮件" />
        </label>
        <div className="flex-1" />
        {loadedAt && (
          <span className="subtle text-[12px] whitespace-nowrap" title={formatDate(loadedAt)}>
            更新于 {formatRelative(loadedAt)}
          </span>
        )}
      </div>

      {error && messages.length > 0 && (
        <div
          className="card px-4 py-3 text-[13px] flex items-center justify-between gap-3"
          role="status"
          style={{ color: 'var(--amber)' }}
        >
          <span>当前显示本机缓存；刷新失败：{error}</span>
          <Button variant="gray" size="sm" onClick={() => void load(sinceMinutes)}>
            重试
          </Button>
        </div>
      )}

      {/* ---- list (fills the rest of the page, scrolls internally) ---- */}
      {restoring && messages.length === 0 ? (
        <p className="muted">正在读取本地缓存…</p>
      ) : loading && messages.length === 0 ? (
        <p className="muted">拉取中…</p>
      ) : error && messages.length === 0 ? (
        <div className="card p-10 text-center" style={{ color: 'var(--amber)' }}>
          {error}
        </div>
      ) : messages.length === 0 ? (
        <div className="card p-10 text-center muted">
          该时间段内没有发往任何别名的邮件 · 也可能是还没有账户连接收件邮箱（去「账户」页填 App 专用密码）
        </div>
      ) : shown.length === 0 ? (
        <div className="card p-10 text-center muted">
          没有匹配的邮件
          <Button
            variant="plain"
            size="sm"
            onClick={() => {
              setQuery('');
              setOnlyCodes(false);
            }}
          >
            清除筛选
          </Button>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto rounded-[18px]">
          <div className="flex flex-col gap-2">
            {shown.map((m) => {
              const { code, link } = pickCodeOrLink(m);
              return (
                // The same message can reach several aliases at once (one row each).
                <div key={mailMessageKey(m)} className="list p-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      className="mono font-semibold truncate text-left hover:opacity-70 text-[13px] min-w-0"
                      style={{ color: 'var(--accent)' }}
                      onClick={() => void copy(m.alias)}
                      title="点击复制该别名"
                    >
                      {m.alias}
                    </button>
                    <span
                      className="subtle text-[11px] truncate flex-none max-w-[220px]"
                      title={`所属账户：${accountLabel(m.accountId)}`}
                    >
                      · {accountLabel(m.accountId)}
                    </span>
                    <div className="flex-1" />
                    <span
                      className="subtle text-[12px] whitespace-nowrap flex-none"
                      title={formatDate(m.date)}
                    >
                      {formatRelative(m.date)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold truncate flex-1">{m.subject || '(无主题)'}</span>
                    <Button size="sm" variant="tinted" className="flex-none" onClick={() => setViewMsg(m)}>
                      查看邮件
                    </Button>
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
                    {m.from} · 收件时间 {formatDate(m.date)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {viewMsg && (
        <EmailViewer message={{ ...viewMsg, to: viewMsg.alias }} onClose={() => setViewMsg(null)} />
      )}
    </div>
  );
}
