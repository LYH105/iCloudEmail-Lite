import { Badge, Button, Field, Sheet, Switch, formatDate, formatRelative } from '../../ui';
import type { MarkRulesController } from './useMarkRules';

export function RulesSheet({ controller: c }: { controller: MarkRulesController }) {
  if (!c.open) return null;
  return (
    <Sheet
      title="标记规则"
      footer={
        <>
          <Button variant="gray" className="flex-1" onClick={c.closeSheet} disabled={c.busy}>
            关闭
          </Button>
          <Button className="flex-1" onClick={() => void c.saveRule()} disabled={c.busy}>
            {c.busy ? '保存中…' : c.editId ? '保存修改' : '添加规则'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="muted text-[13px] leading-relaxed -mt-1">
          收到匹配的邮件时自动给别名打标记，标记会累加保留。填写的条件需同时满足； 每个条件可用{' '}
          <span className="mono">|</span> 分隔多个关键词（任一命中）。
          集齐所有已启用标记后，整行会变绿表示可用。
        </p>
        <div className="flex gap-2">
          <Button
            variant="gray"
            size="sm"
            onClick={() => void c.exportRules()}
            disabled={c.rules.length === 0}
          >
            导出规则
          </Button>
          <Button variant="gray" size="sm" onClick={() => c.fileRef.current?.click()}>
            导入规则
          </Button>
          <input
            ref={c.fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(event) => {
              void c.importRulesFile(event.target.files?.[0] ?? null);
              event.target.value = '';
            }}
          />
        </div>
        {c.rules.length > 0 && (
          <div className="list">
            {c.rules.map((rule) => (
              <div key={rule.id} className="list-row" style={{ padding: '9px 12px' }}>
                <div className="flex-1 min-w-0">
                  <Badge tone={rule.enabled ? 'green' : 'gray'}>{rule.mark}</Badge>
                  <div className="subtle text-[11px] truncate mt-1">
                    {[
                      rule.fromContains && `发件人含「${rule.fromContains}」`,
                      rule.subjectContains && `主题含「${rule.subjectContains}」`,
                      rule.bodyContains && `正文含「${rule.bodyContains}」`,
                    ]
                      .filter(Boolean)
                      .join(' 且 ')}
                  </div>
                </div>
                <Switch
                  size="sm"
                  checked={rule.enabled}
                  onChange={() => void c.toggleRule(rule)}
                  label={`${rule.mark} 规则${rule.enabled ? '已启用' : '已停用'}`}
                />
                <Button variant="gray" size="sm" onClick={() => c.editRule(rule)}>
                  编辑
                </Button>
                <Button variant="danger" size="sm" onClick={() => void c.removeRule(rule)}>
                  删
                </Button>
              </div>
            ))}
          </div>
        )}

        {c.orphans.length > 0 && (
          <>
            <div className="hairline" />
            <div className="font-semibold text-[14px]">未被规则使用的标记</div>
            <p className="muted text-[12px] leading-relaxed -mt-1">
              这些是规则改名或删除前遗留在别名上的标记。可并入现在的标记，或直接清除。
            </p>
            <div className="list">
              {c.orphans.map((orphan) => {
                const target = c.orphanTarget[orphan.mark] ?? c.suggestTarget(orphan.mark);
                const busy = c.orphanBusy === orphan.mark;
                return (
                  <div key={orphan.mark} className="list-row" style={{ padding: '9px 12px' }}>
                    <div className="flex-1 min-w-0">
                      <Badge tone="amber">{orphan.mark}</Badge>
                      <div
                        className="subtle text-[11px] truncate mt-1"
                        title={`最近命中 ${formatDate(orphan.lastHitAt)}`}
                      >
                        {orphan.aliases} 个别名 · {formatRelative(orphan.lastHitAt)}
                      </div>
                    </div>
                    <select
                      className="input input-sm"
                      style={{ width: 'auto', flex: 'none', maxWidth: 150 }}
                      aria-label={`将 ${orphan.mark} 合并到`}
                      value={target}
                      onChange={(event) =>
                        c.setOrphanTarget((current) => ({
                          ...current,
                          [orphan.mark]: event.target.value,
                        }))
                      }
                    >
                      <option value="">合并到…</option>
                      {c.markNames.map((mark) => (
                        <option key={mark} value={mark}>
                          {mark}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="gray"
                      size="sm"
                      disabled={busy || !target}
                      onClick={() => void c.mergeOrphan(orphan)}
                    >
                      合并
                    </Button>
                    {c.orphanConfirm === orphan.mark ? (
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={busy}
                        onClick={() => void c.clearOrphan(orphan)}
                      >
                        {busy ? '清除中…' : `确认清除 ${orphan.aliases} 个`}
                      </Button>
                    ) : (
                      <Button variant="danger" size="sm" onClick={() => c.setOrphanConfirm(orphan.mark)}>
                        清除
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="hairline" />
        <div className="font-semibold text-[14px]">{c.editId ? '编辑规则' : '新增规则'}</div>
        <Field label="标记名（如：已注册 / 已开通）">
          <input className="input" value={c.mark} onChange={(event) => c.setMark(event.target.value)} />
        </Field>
        <Field label="发件人包含（可选，| 分隔多关键词）">
          <input
            className="input"
            value={c.from}
            placeholder="如 noreply@example.com|support"
            onChange={(event) => c.setFrom(event.target.value)}
          />
        </Field>
        <Field label="主题包含（可选）">
          <input
            className="input"
            value={c.subject}
            placeholder="如 注册成功|欢迎|verify"
            onChange={(event) => c.setSubject(event.target.value)}
          />
        </Field>
        <Field label="正文包含（可选）">
          <input className="input" value={c.body} onChange={(event) => c.setBody(event.target.value)} />
        </Field>
        {c.editId && (
          <Button variant="plain" size="sm" onClick={c.resetForm}>
            取消编辑，改为新增
          </Button>
        )}
      </div>
    </Sheet>
  );
}
