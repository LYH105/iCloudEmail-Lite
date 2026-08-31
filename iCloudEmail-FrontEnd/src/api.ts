import type {
  AccountPublic,
  AliasPublic,
  ApiKeyPublic,
  AutoCreateLogPublic,
  CodeOutcome,
  CreatedApiKey,
  FetchedMessage,
  ImapConfigPublic,
  LibraryMessage,
  LoginOutcome,
  MarkRule,
  MarkRuleExport,
  OverviewPublic,
  OrphanMark,
  ScanResult,
} from './types';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
const KEY_STORAGE = 'icloud-hme.apiKey';
const DEFAULT_TIMEOUT_MS = 60_000;

export const AUTH_REQUIRED_EVENT = 'icloud-hme:auth-required';
export const CLEAR_PRIVATE_CACHE_EVENT = 'icloud-hme:clear-private-cache';

function emitWindowEvent(name: string, detail?: unknown): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function getStoredKey(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}
export function setStoredKey(key: string): void {
  if (getStoredKey() !== key) emitWindowEvent(CLEAR_PRIVATE_CACHE_EVENT);
  localStorage.setItem(KEY_STORAGE, key);
}
export function clearStoredKey(): void {
  try {
    localStorage.removeItem(KEY_STORAGE);
  } catch {
    // The auth-required event still lets the UI recover when storage is blocked.
  }
  emitWindowEvent(CLEAR_PRIVATE_CACHE_EVENT);
}

/** A stable cache namespace that never contains the API key itself. */
export function getApiCacheNamespace(): string {
  const origin =
    BASE_URL || (typeof window !== 'undefined' && window.location ? window.location.origin : 'same-origin');
  const input = `${origin}\u0000${getStoredKey() ?? 'anonymous'}`;
  // FNV-1a is sufficient here: API keys have high entropy and the output is
  // used only to isolate local caches, never as an authentication primitive.
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
    readonly code?: 'http' | 'network' | 'timeout' | 'aborted' | 'invalid_response',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  auth?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function responseMessage(status: number, statusText: string, body: unknown, text: string): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim()) return error;
  }
  const plain = text.trim().replace(/\s+/g, ' ');
  if (plain) return plain.slice(0, 300);
  return statusText || `请求失败（${status}）`;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  options: RequestOptions | boolean = {},
): Promise<T> {
  const normalized: RequestOptions = typeof options === 'boolean' ? { auth: options } : options;
  const auth = normalized.auth ?? true;
  const headers = new Headers(init.headers);
  // Only declare a JSON body when we actually send one — otherwise Fastify
  // rejects the empty body ("Body cannot be empty ... application/json").
  if (init.body !== undefined && init.body !== null) {
    headers.set('Content-Type', 'application/json');
  }
  if (auth) {
    const key = getStoredKey();
    if (key) headers.set('Authorization', `Bearer ${key}`);
  }
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(normalized.signal?.reason);
  if (normalized.signal?.aborted) abortFromCaller();
  else normalized.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, normalized.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let res: Response;
  let text: string;
  try {
    res = await fetch(`${BASE_URL}${path}`, { ...init, headers, signal: controller.signal });
    text = await res.text();
  } catch (error) {
    if (controller.signal.aborted) {
      if (timedOut) {
        throw new ApiError(0, '请求超时，请检查网络后重试', undefined, 'timeout');
      }
      throw new ApiError(0, '请求已取消', undefined, 'aborted');
    }
    throw new ApiError(
      0,
      '无法连接到本地服务，请确认应用后端已启动',
      error instanceof Error ? error.message : error,
      'network',
    );
  } finally {
    clearTimeout(timeout);
    normalized.signal?.removeEventListener('abort', abortFromCaller);
  }

  const contentType = res.headers.get('content-type') ?? '';
  let body: unknown;
  let invalidJson = false;
  if (text) {
    if (contentType.includes('json')) {
      try {
        body = JSON.parse(text);
      } catch {
        invalidJson = true;
      }
    }
  }
  if (!res.ok) {
    const details = body && typeof body === 'object' && 'details' in body ? body.details : undefined;
    if (auth && res.status === 401) {
      try {
        localStorage.removeItem(KEY_STORAGE);
      } catch {
        // The event below still moves the UI back to its authentication gate.
      }
      emitWindowEvent(CLEAR_PRIVATE_CACHE_EVENT);
      emitWindowEvent(AUTH_REQUIRED_EVENT, { path, status: res.status });
    }
    throw new ApiError(res.status, responseMessage(res.status, res.statusText, body, text), details, 'http');
  }
  if (text && (!contentType.includes('json') || invalidJson)) {
    throw new ApiError(
      res.status,
      invalidJson ? '服务返回了无法解析的数据' : '服务返回了意外的数据格式',
      text.slice(0, 300),
      'invalid_response',
    );
  }
  return body as T;
}

const jsonBody = (data: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(data) });

export const api = {
  // ---- runtime config / bootstrap / api keys ----
  config: () => request<{ authDisabled: boolean }>('/api/config', {}, { auth: false, timeoutMs: 10_000 }),
  bootstrap: () =>
    request<{ needsBootstrap: boolean }>('/api/apikeys/bootstrap', {}, { auth: false, timeoutMs: 10_000 }),
  createFirstKey: (name: string) =>
    request<{ apiKey: CreatedApiKey }>('/api/apikeys', jsonBody({ name }), { auth: false }),
  overview: () => request<OverviewPublic>('/api/overview'),
  listApiKeys: () => request<{ apiKeys: ApiKeyPublic[] }>('/api/apikeys'),
  createApiKey: (name: string, scopes: ('read' | 'write')[]) =>
    request<{ apiKey: CreatedApiKey }>('/api/apikeys', jsonBody({ name, scopes })),
  revokeApiKey: (id: string) =>
    request<{ revoked: boolean }>(`/api/apikeys/${id}/revoke`, { method: 'POST' }),
  deleteApiKey: (id: string) => request<{ deleted: boolean }>(`/api/apikeys/${id}`, { method: 'DELETE' }),

  // ---- accounts ----
  listAccounts: () => request<{ accounts: AccountPublic[] }>('/api/accounts'),
  getAccount: (id: string) => request<{ account: AccountPublic }>(`/api/accounts/${id}`),
  login: (data: {
    label?: string;
    appleId: string;
    password: string;
    china: boolean;
    rememberPassword?: boolean;
  }) => request<LoginOutcome>('/api/accounts/login', jsonBody(data)),
  relogin: (id: string, data: { password?: string; china?: boolean; rememberPassword?: boolean } = {}) =>
    request<LoginOutcome>(`/api/accounts/${id}/relogin`, jsonBody(data)),
  resumeCode: (id: string) => request<LoginOutcome>(`/api/accounts/${id}/resume-code`, { method: 'POST' }),
  resendCode: (id: string) => request<LoginOutcome>(`/api/accounts/${id}/resend-code`, { method: 'POST' }),
  verifyCode: (id: string, code: string) =>
    request<CodeOutcome>(`/api/accounts/${id}/verify-code`, jsonBody({ code })),
  deleteAccount: (id: string) => request<{ deleted: boolean }>(`/api/accounts/${id}`, { method: 'DELETE' }),
  updateAccountSettings: (
    id: string,
    data: {
      label?: string;
      imapPassword?: string;
      imapUsername?: string;
      autoCreateEnabled?: boolean;
      clearLoginPassword?: boolean;
    },
  ) => request<{ account: AccountPublic }>(`/api/accounts/${id}/settings`, jsonBody(data)),
  setAccountDisabled: (id: string, disabled: boolean) =>
    request<{ account: AccountPublic }>(`/api/accounts/${id}/disabled`, jsonBody({ disabled })),
  recoverAccount: (id: string) =>
    request<{ ok: boolean; outcome: string; message: string; account: AccountPublic }>(
      `/api/accounts/${id}/recover`,
      { method: 'POST' },
    ),
  setAccountImap: (id: string, password: string, username?: string) =>
    request<{ ok: boolean }>(`/api/accounts/${id}/imap`, jsonBody({ password, username })),
  clearAccountImap: (id: string) =>
    request<{ ok: boolean }>(`/api/accounts/${id}/imap`, { method: 'DELETE' }),
  testAccountImap: (id: string) =>
    request<{ ok: boolean }>(`/api/accounts/${id}/imap/test`, { method: 'POST' }),
  openAccountPage: (id: string, url?: string) =>
    request<{ opened: boolean }>(`/api/accounts/${id}/open-page`, jsonBody(url ? { url } : {})),
  createAliasBatch: (accountId: string, count = 5, label = 'AI注册') =>
    request<{
      created: AliasPublic[];
      errors: { index: number; message: string }[];
    }>(`/api/accounts/${accountId}/aliases/batch`, jsonBody({ count, label })),

  // ---- alias library (cross-account) ----
  listAllAliases: () => request<{ aliases: AliasPublic[] }>('/api/aliases'),
  syncAllAliases: () =>
    request<{ synced: number; errors: { account: string; message: string }[] }>('/api/aliases/sync', {
      method: 'POST',
    }),
  scanAllMarks: () => request<ScanResult>('/api/aliases/scan-marks', { method: 'POST' }),
  // 总邮件库: one aggregate inbox across every alias of every connected account.
  mailLibrary: (sinceMinutes = 1440, options: { signal?: AbortSignal } = {}) =>
    request<{ messages: LibraryMessage[] }>(
      `/api/aliases/mail-library?sinceMinutes=${sinceMinutes}`,
      {},
      { signal: options.signal, timeoutMs: 120_000 },
    ),

  // ---- aliases (per-account) ----
  setAliasUsed: (accountId: string, anonymousId: string, used: boolean) =>
    request<{ alias: AliasPublic }>(`/api/accounts/${accountId}/aliases/${anonymousId}/used`, {
      method: 'PATCH',
      body: JSON.stringify({ used }),
    }),
  deleteAlias: (accountId: string, anonymousId: string) =>
    request<{ deleted: boolean }>(`/api/accounts/${accountId}/aliases/${anonymousId}`, {
      method: 'DELETE',
    }),
  aliasMail: (
    accountId: string,
    anonymousId: string,
    params: { sinceMinutes?: number; limit?: number } = {},
  ) => {
    const q = new URLSearchParams();
    if (params.sinceMinutes) q.set('sinceMinutes', String(params.sinceMinutes));
    if (params.limit) q.set('limit', String(params.limit));
    return request<{ alias: string; messages: FetchedMessage[] }>(
      `/api/accounts/${accountId}/aliases/${anonymousId}/mail?${q}`,
    );
  },

  // ---- mark rules & inbox scanning ----
  listMarkRules: () => request<{ rules: MarkRule[] }>('/api/mark-rules'),
  createMarkRule: (data: {
    mark: string;
    fromContains?: string | null;
    subjectContains?: string | null;
    bodyContains?: string | null;
    enabled?: boolean;
  }) => request<{ rule: MarkRule }>('/api/mark-rules', jsonBody(data)),
  updateMarkRule: (
    id: string,
    data: {
      mark: string;
      fromContains?: string | null;
      subjectContains?: string | null;
      bodyContains?: string | null;
      enabled?: boolean;
    },
  ) =>
    request<{ rule: MarkRule }>(`/api/mark-rules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteMarkRule: (id: string) =>
    request<{ deleted: boolean }>(`/api/mark-rules/${id}`, { method: 'DELETE' }),
  listOrphanMarks: () => request<{ orphans: OrphanMark[] }>('/api/mark-rules/orphans'),
  renameMark: (from: string, to: string) =>
    request<{ renamed: number }>('/api/mark-rules/marks/rename', jsonBody({ from, to })),
  clearMark: (mark: string) =>
    request<{ cleared: number }>(`/api/mark-rules/marks/${encodeURIComponent(mark)}`, {
      method: 'DELETE',
    }),
  exportMarkRules: () => request<{ rules: MarkRuleExport[] }>('/api/mark-rules/export'),
  importMarkRules: (rules: MarkRuleExport[]) =>
    request<{ imported: number; skipped: number }>('/api/mark-rules/import', jsonBody({ rules })),

  // ---- imap ----
  listImap: () => request<{ configs: ImapConfigPublic[] }>('/api/imap'),
  createImap: (data: {
    label: string;
    host: string;
    port?: number;
    secure?: boolean;
    username: string;
    password: string;
    accountId?: string | null;
  }) => request<{ config: ImapConfigPublic }>('/api/imap', jsonBody(data)),
  deleteImap: (id: string) => request<{ deleted: boolean }>(`/api/imap/${id}`, { method: 'DELETE' }),
  testImap: (id: string) => request<{ ok: boolean }>(`/api/imap/${id}/test`, { method: 'POST' }),
  fetchCodes: (id: string, params: { sinceMinutes?: number; limit?: number; filterTo?: string }) => {
    const q = new URLSearchParams();
    if (params.sinceMinutes) q.set('sinceMinutes', String(params.sinceMinutes));
    if (params.limit) q.set('limit', String(params.limit));
    if (params.filterTo) q.set('filterTo', params.filterTo);
    return request<{ messages: FetchedMessage[] }>(`/api/imap/${id}/codes?${q}`);
  },

  // ---- auto-create logs ----
  listAutoCreateLogs: () => request<{ logs: AutoCreateLogPublic[] }>('/api/auto-create-logs'),
};
