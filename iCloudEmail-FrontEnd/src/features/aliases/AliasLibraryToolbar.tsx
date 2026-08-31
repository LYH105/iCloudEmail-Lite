import type { AccountPublic } from '../../types';
import { COMPLETE_MARK_FILTER, NO_MARK_FILTER } from './libraryLogic';

interface Props {
  accountFilter: string;
  query: string;
  markFilter: string;
  imapAccounts: AccountPublic[];
  poolCount: number;
  shownCount: number;
  totalActive: number;
  markOptions: string[];
  enabledMarks: string[];
  onAccountFilter: (value: string) => void;
  onQuery: (value: string) => void;
  onMarkFilter: (value: string) => void;
}

export function AliasLibraryToolbar({
  accountFilter,
  query,
  markFilter,
  imapAccounts,
  poolCount,
  shownCount,
  totalActive,
  markOptions,
  enabledMarks,
  onAccountFilter,
  onQuery,
  onMarkFilter,
}: Props) {
  return (
    <>
      {poolCount > 0 && (
        <div className="card px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="muted text-[13px] whitespace-nowrap">{imapAccounts.length} 个已连邮箱账户</span>
          <div className="flex-1" />
          <span className="muted text-[12px] whitespace-nowrap">
            共 {poolCount} · 启用 {totalActive} · 停用 {poolCount - totalActive}
          </span>
        </div>
      )}

      <div className="flex items-center gap-3 px-1 flex-wrap" role="search">
        <h3 className="text-[15px] font-bold whitespace-nowrap">
          {shownCount}
          {shownCount !== poolCount && <span className="subtle text-[12px] font-normal"> / {poolCount}</span>}
        </h3>
        {imapAccounts.length > 1 && (
          <select
            className="input input-sm"
            style={{ width: 'auto', flex: 'none' }}
            aria-label="按账户筛选"
            value={accountFilter}
            onChange={(event) => onAccountFilter(event.target.value)}
          >
            <option value="">全部账户</option>
            {imapAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.appleId ?? account.label ?? account.id}
              </option>
            ))}
          </select>
        )}
        <input
          className="input input-sm"
          style={{ width: 'auto', flex: '0 1 280px' }}
          type="search"
          aria-label="搜索隐藏邮箱"
          placeholder="搜索地址 / 标签 / 备注 / 标记 / 账户…"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
        {(markOptions.length > 0 || markFilter) && (
          <select
            className="input input-sm"
            style={{ width: 'auto', flex: 'none' }}
            aria-label="按标记筛选"
            value={markFilter}
            onChange={(event) => onMarkFilter(event.target.value)}
          >
            <option value="">全部标记（按创建时间）</option>
            {enabledMarks.length > 0 && <option value={COMPLETE_MARK_FILTER}>可用（按命中时间）</option>}
            {markOptions.map((mark) => (
              <option key={mark} value={mark}>
                {mark}（按命中时间）
              </option>
            ))}
            <option value={NO_MARK_FILTER}>未标记</option>
          </select>
        )}
      </div>
    </>
  );
}
