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
  OrphanMark,
  ScanResult,
} from './types';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
const KEY_STORAGE = 'icloud-hme.apiKey';

export function getStoredKey(): string | null {
  return localStorage.getItem(KEY_STORAGE);
}
export function setStoredKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key);
}
export function clearStoredKey(): void {
  localStorage.removeItem(KEY_STORAGE);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
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
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? res.statusText, body?.details);
  }
  return body as T;
}

const jsonBody = (data: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(data) });

export const api = {
  // ---- runtime config / bootstrap / api keys ----
  config: () => request<{ authDisabled: boolean }>('/api/config', {}, false),
  bootstrap: () => request<{ needsBootstrap: boolean }>('/api/apikeys/bootstrap', {}, false),
  createFirstKey: (name: string) =>
    request<{ apiKey: CreatedApiKey }>('/api/apikeys', jsonBody({ name }), false),
  listApiKeys: () => request<{ apiKeys: ApiKeyPublic[] }>('/api/apikeys'),
  createApiKey: (name: string, scopes: ('read' | 'write')[]) =>
    request<{ apiKey: CreatedApiKey }>('/api/apikeys', jsonBody({ name, scopes })),
  revokeApiKey: (id: string) =>
    request<{ revoked: boolean }>(`/api/apikeys/${id}/revoke`, { method: 'POST' }),
  deleteApiKey: (id: string) =>
    request<{ deleted: boolean }>(`/api/apikeys/${id}`, { method: 'DELETE' }),

  // ---- accounts ----
  listAccounts: () => request<{ accounts: AccountPublic[] }>('/api/accounts'),
  getAccount: (id: string) => request<{ account: AccountPublic }>(`/api/accounts/${id}`),
  login: (data: { label?: string; appleId: string; password: string; china: boolean }) =>
    request<LoginOutcome>('/api/accounts/login', jsonBody(data)),
  relogin: (id: string, data: { password?: string; china?: boolean } = {}) =>
    request<LoginOutcome>(`/api/accounts/${id}/relogin`, jsonBody(data)),
  resumeCode: (id: string) =>
    request<LoginOutcome>(`/api/accounts/${id}/resume-code`, { method: 'POST' }),
  resendCode: (id: string) =>
    request<LoginOutcome>(`/api/accounts/${id}/resend-code`, { method: 'POST' }),
  verifyCode: (id: string, code: string) =>
    request<CodeOutcome>(`/api/accounts/${id}/verify-code`, jsonBody({ code })),
  deleteAccount: (id: string) =>
    request<{ deleted: boolean }>(`/api/accounts/${id}`, { method: 'DELETE' }),
  updateAccountSettings: (
    id: string,
    data: {
      label?: string;
      imapPassword?: string;
      imapUsername?: string;
      autoCreateEnabled?: boolean;
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
    request<{ opened: boolean }>(
      `/api/accounts/${id}/open-page`,
      jsonBody(url ? { url } : {}),
    ),
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
  mailLibrary: (sinceMinutes = 1440) =>
    request<{ messages: LibraryMessage[] }>(
      `/api/aliases/mail-library?sinceMinutes=${sinceMinutes}`,
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
  deleteImap: (id: string) =>
    request<{ deleted: boolean }>(`/api/imap/${id}`, { method: 'DELETE' }),
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
