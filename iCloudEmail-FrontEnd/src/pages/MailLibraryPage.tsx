import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { api } from '../api';
import type { AccountPublic, LibraryMessage } from '../types';
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

const DEFAULT_WINDOW = '43200';
const AUTO_REFRESH_MS = 30_000;
const CACHE_DB_NAME = 'icloud-hme-mail-cache';
const CACHE_STORE_NAME = 'windows';
// Overlap added to an incremental pull so a message that arrived while the
// previous one was in flight can't slip through the gap.
const INCREMENTAL_OVERLAP_MINUTES = 3;

interface MailCacheEntry {
  messages: LibraryMessage[];
  loadedAt: number;
}

interface StoredMailCacheEntry extends MailCacheEntry {
  window: string;
}

/**
 * Mail already pulled is kept in memory for instant tab switches and in
 * IndexedDB for application restarts. A full pull is a real IMAP round-trip
 * across every connected account, so returning to the tab only restores this
 * cache; refreshes merge in mail newer than the newest cached message.
 *
 * Keyed by time window; the selected window and the account labels are
 * remembered the same way.
 */
const cache = new Map<string, MailCacheEntry>();
let lastWindow: string = DEFAULT_WINDOW;
let accountCache: AccountPublic[] = [];
let cacheDbPromise: Promise<IDBDatabase> | null = null;

function openCacheDb(): Promise<IDBDatabase> {
  if (cacheDbPromise) return cacheDbPromise;
  cacheDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CACHE_STORE_NAME)) {
        request.result.createObjectStore(CACHE_STORE_NAME, { keyPath: 'window' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开邮件缓存'));
  });
  return cacheDbPromise;
}

async function readLocalCache(window: string): Promise<MailCacheEntry | null> {
  const memory = cache.get(window);
  if (memory) return memory;
  try {
    const db = await openCacheDb();
    const stored = await new Promise<StoredMailCacheEntry | undefined>((resolve, reject) => {
      const request = db.transaction(CACHE_STORE_NAME, 'readonly').objectStore(CACHE_STORE_NAME).get(window);
      request.onsuccess = () => resolve(request.result as StoredMailCacheEntry | undefined);
      request.onerror = () => reject(request.error ?? new Error('无法读取邮件缓存'));
    });
    if (!stored || !Array.isArray(stored.messages) || !Number.isFinite(stored.loadedAt)) return null;
    const entry = {
      messages: merge([], stored.messages, Number(window)),
      loadedAt: stored.loadedAt,
    };
    cache.set(window, entry);
    return entry;
  } catch {
    // Private browsing or a full disk can make IndexedDB unavailable. The
    // in-memory cache still works for the current application session.
    return null;
  }
}

async function writeLocalCache(window: string, entry: MailCacheEntry): Promise<void> {
  cache.set(window, entry);
  try {
    const db = await openCacheDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(CACHE_STORE_NAME, 'readwrite');
      transaction.objectStore(CACHE_STORE_NAME).put({ window, ...entry } satisfies StoredMailCacheEntry);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('无法写入邮件缓存'));
      transaction.onabort = () => reject(transaction.error ?? new Error('邮件缓存写入已中止'));
    });
  } catch {
    // A cache write must never make a successful IMAP refresh look failed.
  }
}

const msgKey = (m: LibraryMessage) => `${m.accountId}:${m.uid}:${m.alias}`;

/**
 * Fold a fresh pull into what we already had: newly fetched copies win, mail
 * that has aged out of the selected window is dropped, newest first.
 */
function merge(
  existing: LibraryMessage[],
  fetched: LibraryMessage[],
  windowMinutes: number,
): LibraryMessage[] {
  const cutoff = Date.now() - windowMinutes * 60_000;
  const byKey = new Map(existing.map((m) => [msgKey(m), m]));
  for (const m of fetched) byKey.set(msgKey(m), m);
  return [...byKey.values()]
    .filter((m) => {
      const at = new Date(m.date).getTime();
      return !Number.isFinite(at) || at >= cutoff;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * 最近邮件: one aggregate inbox across every alias of every IMAP-connected
 * account (GET /api/aliases/mail-library). Each row is tagged with the alias
 * it reached and the account that alias belongs to, so a freshly-arrived
 * verification code can be grabbed without first hunting it down in 邮箱库.
 */
export function MailLibraryPage() {
  const toast = useToast();
  const [sinceMinutes, setSinceMinutes] = useState<string>(lastWindow);
  const [messages, setMessages] = useState<LibraryMessage[]>(
    () => cache.get(lastWindow)?.messages ?? [],
  );
  const [accounts, setAccounts] = useState<AccountPublic[]>(accountCache);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(() => !cache.has(lastWindow));
  const [loadedAt, setLoadedAt] = useState<number | null>(
    () => cache.get(lastWindow)?.loadedAt ?? null,
  );
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [onlyCodes, setOnlyCodes] = useState(false);
  const [auto, setAuto] = useState(false);
  const [viewMsg, setViewMsg] = useState<LibraryMessage | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    startScrollTop: number;
  } | null>(null);
  // Newest request wins: a slow reply for a window the user has already
  // switched away from must not land on top of what's on screen.
  const seqRef = useRef(0);
  // An IMAP round-trip can outlast the auto-refresh interval — don't stack.
  const inFlight = useRef(false);

  /**
   * Pull mail for `minutes`. Incrementally by default: only the span since the
   * last successful pull is requested, and the result is merged into the local
   * cache. This remains efficient even when no mail arrived in that interval.
   * A window with nothing cached always pulls the whole span.
   */
  const load = async (
    minutes: string,
    opts: { silent?: boolean; full?: boolean } = {},
  ): Promise<void> => {
    if (opts.silent && inFlight.current) return;
    const cached = cache.get(minutes);
    const lastPulledAt = cached?.loadedAt ?? NaN;
    const span =
      opts.full || !Number.isFinite(lastPulledAt)
        ? Number(minutes)
        : Math.min(
            Number(minutes),
            Math.ceil((Date.now() - lastPulledAt) / 60_000) + INCREMENTAL_OVERLAP_MINUTES,
          );

    const seq = ++seqRef.current;
    inFlight.current = true;
    if (!opts.silent) setLoading(true);
    try {
      // Store the request's start time as the covered-through watermark. If
      // the IMAP round-trip takes a while, the next overlap safely covers it.
      const requestedAt = Date.now();
      const r = await api.mailLibrary(Math.max(1, span));
      const next = merge(cached?.messages ?? [], r.messages, Number(minutes));
      await writeLocalCache(minutes, { messages: next, loadedAt: requestedAt });
      if (seq !== seqRef.current) return; // superseded by a newer request
      setMessages(next);
      setLoadedAt(requestedAt);
      setError('');
    } catch (e) {
      if (seq !== seqRef.current) return;
      setError(errorMessage(e));
      if (!opts.silent) toast.error(errorMessage(e));
    } finally {
      inFlight.current = false;
      if (!opts.silent && seq === seqRef.current) setLoading(false);
    }
  };

  // Account labels for the per-row tag — cheap, local, and cached across mounts.
  useEffect(() => {
    if (accountCache.length > 0) return;
    api
      .listAccounts()
      .then((r) => {
        accountCache = r.accounts;
        setAccounts(r.accounts);
      })
      .catch(() => {
        // Only affects the account tag; the mail list stands on its own.
      });
  }, []);

  // Opening the tab (or switching window) restores the durable local cache
  // immediately, then silently fills only the gap since its last successful
  // pull. A window that has never been cached needs one initial full pull.
  useEffect(() => {
    lastWindow = sinceMinutes;
    const memory = cache.get(sinceMinutes);
    setMessages(memory?.messages ?? []);
    setLoadedAt(memory?.loadedAt ?? null);
    setError('');
    setRestoring(!memory);

    const seq = ++seqRef.current;
    void readLocalCache(sinceMinutes).then((hit) => {
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
  }, [sinceMinutes]);

  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => void load(sinceMinutes, { silent: true }), AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [auto, sinceMinutes]);

  // Keep "更新于 X 分钟前" truthful while the tab sits open — it's the only
  // signal that what's on screen came from the cache rather than a fresh pull.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!loadedAt) return;
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [loadedAt]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest('button, input, a, label')) return;

    const list = event.currentTarget;
    const bounds = list.getBoundingClientRect();
    const scrollbarWidth = list.offsetWidth - list.clientWidth;
    if (scrollbarWidth > 0 && event.clientX >= bounds.right - scrollbarWidth) return;

    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollTop: list.scrollTop,
    };
    list.setPointerCapture(event.pointerId);
    list.style.cursor = 'grabbing';
    event.preventDefault();
  };

  const drag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.currentTarget.scrollTop = state.startScrollTop - (event.clientY - state.startY);
    event.preventDefault();
  };

  const stopDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.currentTarget.style.cursor = '';
  };

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
    <div className="flex flex-col gap-4 h-full min-h-0">
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
            <Button
              variant="tinted"
              size="sm"
              onClick={() => void load(sinceMinutes)}
              disabled={loading}
            >
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
          <Switch size="sm" checked={onlyCodes} onChange={() => setOnlyCodes(!onlyCodes)} />
        </label>
        <label className="flex items-center gap-1.5" title="每 30 秒自动取一次新邮件">
          <span className="subtle text-[12px] whitespace-nowrap">自动刷新</span>
          <Switch size="sm" checked={auto} onChange={() => setAuto(!auto)} />
        </label>
        <div className="flex-1" />
        {loadedAt && (
          <span className="subtle text-[12px] whitespace-nowrap" title={formatDate(loadedAt)}>
            更新于 {formatRelative(loadedAt)}
          </span>
        )}
      </div>

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
        <div
          ref={listRef}
          className="flex-1 min-h-0 overflow-y-auto rounded-[18px] select-none"
          onPointerDown={startDrag}
          onPointerMove={drag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
        >
          <div className="flex flex-col gap-2">
            {shown.map((m) => {
              const { code, link } = pickCodeOrLink(m);
              return (
                // The same message can reach several aliases at once (one row each).
                <div key={msgKey(m)} className="list p-3 flex flex-col gap-2">
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
                    <Button
                      size="sm"
                      variant="tinted"
                      className="flex-none"
                      onClick={() => setViewMsg(m)}
                    >
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
