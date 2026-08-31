import { CLEAR_PRIVATE_CACHE_EVENT, getApiCacheNamespace } from '../../api';
import type { LibraryMessage } from '../../types';
import {
  MAIL_CACHE_MAX_ENTRIES,
  MAIL_CACHE_TTL_MS,
  mailCacheStorageKey,
  mergeMailMessages,
} from './mailCacheLogic';

const DATABASE_NAME = 'icloud-hme-mail-cache';
const STORE_NAME = 'windows';
const DATABASE_VERSION = 2;

export interface MailCacheEntry {
  messages: LibraryMessage[];
  loadedAt: number;
}

interface StoredMailCacheEntry extends MailCacheEntry {
  key: string;
  windowMinutes: string;
  namespace: string;
  accessedAt: number;
}

const memoryCache = new Map<string, MailCacheEntry>();
let databasePromise: Promise<IDBDatabase> | null = null;

function currentKey(windowMinutes: string): string {
  return mailCacheStorageKey(getApiCacheNamespace(), windowMinutes);
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      // Version 1 keyed entries only by time window, which could expose cached
      // mail after an API-key/backend switch. Recreate the cache rather than
      // attempting to migrate data that has no trustworthy owner namespace.
      if (request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.deleteObjectStore(STORE_NAME);
      }
      request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开邮件缓存'));
  });
  return databasePromise;
}

function deleteStoredKey(database: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('无法清理邮件缓存'));
    transaction.onabort = () => reject(transaction.error ?? new Error('邮件缓存清理已中止'));
  });
}

export function peekMailCache(windowMinutes: string): MailCacheEntry | null {
  const key = currentKey(windowMinutes);
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.loadedAt > MAIL_CACHE_TTL_MS) {
    memoryCache.delete(key);
    return null;
  }
  return entry;
}

export async function readMailCache(windowMinutes: string): Promise<MailCacheEntry | null> {
  const key = currentKey(windowMinutes);
  const memory = peekMailCache(windowMinutes);
  if (memory) return memory;
  try {
    const database = await openDatabase();
    const stored = await new Promise<StoredMailCacheEntry | undefined>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result as StoredMailCacheEntry | undefined);
      request.onerror = () => reject(request.error ?? new Error('无法读取邮件缓存'));
    });
    if (!stored || !Array.isArray(stored.messages) || !Number.isFinite(stored.loadedAt)) return null;
    if (Date.now() - stored.loadedAt > MAIL_CACHE_TTL_MS) {
      await deleteStoredKey(database, key);
      return null;
    }
    const entry = {
      messages: mergeMailMessages([], stored.messages, Number(windowMinutes)),
      loadedAt: stored.loadedAt,
    };
    memoryCache.set(key, entry);
    return entry;
  } catch {
    // IndexedDB can be unavailable in private browsing or on a full disk. The
    // in-memory cache still works for the current application session.
    return null;
  }
}

async function pruneDatabase(database: IDBDatabase): Promise<void> {
  const stored = await new Promise<StoredMailCacheEntry[]>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as StoredMailCacheEntry[]) ?? []);
    request.onerror = () => reject(request.error ?? new Error('无法检查邮件缓存'));
  });
  const expiredBefore = Date.now() - MAIL_CACHE_TTL_MS;
  const retained = stored
    .filter((entry) => entry.loadedAt >= expiredBefore)
    .sort((left, right) => right.accessedAt - left.accessedAt)
    .slice(0, MAIL_CACHE_MAX_ENTRIES);
  const keep = new Set(retained.map((entry) => entry.key));
  const remove = stored.filter((entry) => !keep.has(entry.key));
  if (remove.length === 0) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    for (const entry of remove) store.delete(entry.key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('无法整理邮件缓存'));
    transaction.onabort = () => reject(transaction.error ?? new Error('邮件缓存整理已中止'));
  });
}

export async function writeMailCache(windowMinutes: string, entry: MailCacheEntry): Promise<void> {
  const namespace = getApiCacheNamespace();
  const key = mailCacheStorageKey(namespace, windowMinutes);
  memoryCache.set(key, entry);
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({
        key,
        namespace,
        windowMinutes,
        accessedAt: Date.now(),
        ...entry,
      } satisfies StoredMailCacheEntry);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('无法写入邮件缓存'));
      transaction.onabort = () => reject(transaction.error ?? new Error('邮件缓存写入已中止'));
    });
    await pruneDatabase(database);
  } catch {
    // Cache persistence must never make a successful IMAP refresh look failed.
  }
}

export async function clearMailCache(): Promise<void> {
  memoryCache.clear();
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('无法清除邮件缓存'));
      transaction.onabort = () => reject(transaction.error ?? new Error('邮件缓存清除已中止'));
    });
  } catch {
    // Clearing the in-memory cache is still useful when IndexedDB is unavailable.
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener(CLEAR_PRIVATE_CACHE_EVENT, () => void clearMailCache());
}
