import type { LibraryMessage } from '../../types';

export const MAIL_CACHE_TTL_MS = 7 * 24 * 60 * 60_000;
export const MAIL_CACHE_MAX_ENTRIES = 8;
export const MAIL_CACHE_MAX_MESSAGES = 3_000;

export function mailMessageKey(message: LibraryMessage): string {
  return `${message.accountId}:${message.uid}:${message.alias}`;
}

export function mailCacheStorageKey(namespace: string, windowMinutes: string): string {
  return `${namespace}:${windowMinutes}`;
}

function messageTime(message: LibraryMessage): number {
  const timestamp = new Date(message.date).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/** Merge newly fetched mail into a bounded, newest-first window. */
export function mergeMailMessages(
  existing: LibraryMessage[],
  fetched: LibraryMessage[],
  windowMinutes: number,
  now = Date.now(),
): LibraryMessage[] {
  const cutoff = now - windowMinutes * 60_000;
  const byKey = new Map(existing.map((message) => [mailMessageKey(message), message]));
  for (const message of fetched) byKey.set(mailMessageKey(message), message);

  return [...byKey.values()]
    .filter((message) => {
      const timestamp = messageTime(message);
      return timestamp === 0 || timestamp >= cutoff;
    })
    .sort((left, right) => messageTime(right) - messageTime(left))
    .slice(0, MAIL_CACHE_MAX_MESSAGES);
}
