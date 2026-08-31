import type { AccountPublic, AliasPublic, MarkRule } from '../../types';

export const COMPLETE_MARK_FILTER = '__complete__';
export const NO_MARK_FILTER = '__none__';

export interface AliasLibraryFilters {
  accountId: string;
  mark: string;
  query: string;
}

export interface AliasLibraryModel {
  accountById: Map<string, AccountPublic>;
  imapAccounts: AccountPublic[];
  pool: AliasPublic[];
  markOptions: string[];
  enabledMarks: string[];
  shown: AliasPublic[];
  totalActive: number;
}

export function isAliasComplete(alias: AliasPublic, enabledMarks: string[]): boolean {
  return (
    enabledMarks.length > 0 && enabledMarks.every((mark) => alias.marks.some((hit) => hit.mark === mark))
  );
}

/** Timestamp of the furthest configured stage reached by an alias. */
export function latestAliasHitAt(alias: AliasPublic, enabledMarks: string[]): number | null {
  for (let index = enabledMarks.length - 1; index >= 0; index--) {
    const configuredMark = enabledMarks[index];
    const hit = alias.marks.find((item) => item.mark === configuredMark);
    if (hit) return hit.hitAt;
  }
  return alias.marks.length ? Math.max(...alias.marks.map((mark) => mark.hitAt)) : null;
}

function searchableAccount(account: AccountPublic | undefined): string {
  if (!account) return '';
  return [account.id, account.appleId, account.label].filter(Boolean).join(' ').toLowerCase();
}

export function buildAliasLibraryModel(
  accounts: AccountPublic[],
  aliases: AliasPublic[],
  rules: MarkRule[],
  filters: AliasLibraryFilters,
): AliasLibraryModel {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const imapAccounts = accounts.filter((account) => account.hasImap && !account.disabled);
  const imapAccountIds = new Set(imapAccounts.map((account) => account.id));
  const pool = aliases.filter((alias) => imapAccountIds.has(alias.accountId));
  const markOptions = Array.from(new Set(pool.flatMap((alias) => alias.marks.map((mark) => mark.mark))));
  const enabledMarks = Array.from(new Set(rules.filter((rule) => rule.enabled).map((rule) => rule.mark)));
  const query = filters.query.trim().toLowerCase();

  const shown = pool
    .filter((alias) => !filters.accountId || alias.accountId === filters.accountId)
    .filter((alias) => {
      if (!filters.mark) return true;
      if (filters.mark === COMPLETE_MARK_FILTER) return isAliasComplete(alias, enabledMarks);
      if (filters.mark === NO_MARK_FILTER) return alias.marks.length === 0;
      return alias.marks.some((mark) => mark.mark === filters.mark);
    })
    .filter((alias) => {
      if (!query) return true;
      return (
        alias.hme.toLowerCase().includes(query) ||
        (alias.label ?? '').toLowerCase().includes(query) ||
        (alias.note ?? '').toLowerCase().includes(query) ||
        alias.marks.some((mark) => mark.mark.toLowerCase().includes(query)) ||
        searchableAccount(accountById.get(alias.accountId)).includes(query)
      );
    })
    .sort((left, right) => {
      if (filters.mark === COMPLETE_MARK_FILTER) {
        return (latestAliasHitAt(right, enabledMarks) ?? 0) - (latestAliasHitAt(left, enabledMarks) ?? 0);
      }
      if (filters.mark && filters.mark !== NO_MARK_FILTER) {
        const leftAt = left.marks.find((mark) => mark.mark === filters.mark)?.hitAt ?? 0;
        const rightAt = right.marks.find((mark) => mark.mark === filters.mark)?.hitAt ?? 0;
        return rightAt - leftAt;
      }
      return (right.createTimestamp ?? 0) - (left.createTimestamp ?? 0);
    });

  return {
    accountById,
    imapAccounts,
    pool,
    markOptions,
    enabledMarks,
    shown,
    totalActive: pool.filter((alias) => alias.isActive).length,
  };
}
