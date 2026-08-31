import type { CSSProperties } from 'react';
import type { AccountPublic, AliasPublic } from '../../types';
import { Badge, Button, Switch, formatDate, formatRelative } from '../../ui';
import { isAliasComplete, latestAliasHitAt } from './libraryLogic';

interface Props {
  loading: boolean;
  imapAccounts: AccountPublic[];
  pool: AliasPublic[];
  shown: AliasPublic[];
  enabledMarks: string[];
  onClearFilters: () => void;
  onCopy: (text: string) => void;
  onFilterMark: (mark: string) => void;
  onToggleUsed: (alias: AliasPublic) => void;
  onOpenMail: (alias: AliasPublic) => void;
  onDeleteRequest: (alias: AliasPublic) => void;
}

export function AliasList({
  loading,
  imapAccounts,
  pool,
  shown,
  enabledMarks,
  onClearFilters,
  onCopy,
  onFilterMark,
  onToggleUsed,
  onOpenMail,
  onDeleteRequest,
}: Props) {
  if (loading)
    return (
      <p className="muted" role="status">
        加载中…
      </p>
    );
  if (imapAccounts.length === 0) {
    return (
      <div className="card p-10 text-center muted">
        还没有已连接邮箱的账户 · 去「账户」页给账户设置 App 专用密码后，这里会自动汇总它的别名
      </div>
    );
  }
  if (pool.length === 0) {
    return (
      <div className="card p-10 text-center muted">
        暂无别名 · 去「账户」页打开定时创建会自动生成，也可点上方「同步」立即从 Apple 拉取现有别名
      </div>
    );
  }
  if (shown.length === 0) {
    return (
      <div className="card p-10 text-center muted">
        没有匹配的别名
        <Button variant="plain" size="sm" onClick={onClearFilters}>
          清除筛选
        </Button>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto rounded-[18px]">
      <div className="list">
        {shown.map((alias) => {
          const complete = isAliasComplete(alias, enabledMarks);
          const hitAt = latestAliasHitAt(alias, enabledMarks);
          const rowStyle: CSSProperties = { padding: '10px 16px' };
          if (complete) rowStyle.background = 'color-mix(in srgb, var(--green) 12%, transparent)';
          return (
            <div key={alias.id} className="list-row" style={rowStyle}>
              <div className="flex-1 min-w-0">
                <button
                  className="mono font-semibold truncate text-left hover:opacity-70 block max-w-full text-[14px]"
                  style={{
                    color: 'var(--accent)',
                    opacity: alias.isActive ? 1 : 0.45,
                    textDecoration: alias.used ? 'line-through' : 'none',
                  }}
                  onClick={() => onCopy(alias.hme)}
                  title="点击复制"
                >
                  {alias.hme}
                </button>
                <div className="subtle text-[11px] truncate mt-0.5">
                  创建于 {formatDate(alias.createTimestamp)}
                </div>
                {alias.marks.length > 0 && (
                  <div className="muted text-[12px] truncate flex items-center gap-1.5 mt-0.5">
                    {alias.marks.map((mark) => (
                      <button
                        key={mark.mark}
                        className="cursor-pointer hover:opacity-75"
                        title={`${mark.source ?? ''} · ${formatDate(mark.hitAt)}（点击筛选该标记）`}
                        onClick={() => onFilterMark(mark.mark)}
                      >
                        <Badge tone="green">{mark.mark}</Badge>
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
                <Switch
                  size="sm"
                  checked={alias.used}
                  onChange={() => onToggleUsed(alias)}
                  label={`${alias.hme} 标记为已使用`}
                />
              </label>
              <div className="flex gap-1.5">
                {alias.isActive && (
                  <Button variant="tinted" size="sm" onClick={() => onOpenMail(alias)}>
                    收件
                  </Button>
                )}
                <Button variant="danger" size="sm" onClick={() => onDeleteRequest(alias)}>
                  删除
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
