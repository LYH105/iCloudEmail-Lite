import { Badge, Button, Field, PageHeader, Sheet, Switch, formatDate } from '../../ui';
import type { AccountsPageController } from './useAccountsPage';

const STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'gray' }> = {
  active: { label: '已登录', tone: 'green' },
  awaiting_code: { label: '等待验证码…', tone: 'amber' },
  session_expired: { label: '会话过期', tone: 'amber' },
  error: { label: '错误', tone: 'red' },
};

function AccountList({ controller: c }: { controller: AccountsPageController }) {
  if (c.loading)
    return (
      <p className="muted" role="status">
        加载中…
      </p>
    );
  if (c.accounts.length === 0) {
    return <div className="card p-10 text-center muted">尚无账户 · 点「添加账户」开始设置</div>;
  }
  return (
    <div className="list">
      {c.accounts.map((account) => {
        const status = STATUS[account.status] ?? { label: account.status, tone: 'gray' as const };
        return (
          <div key={account.id} className="list-row" style={{ opacity: account.disabled ? 0.62 : 1 }}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold truncate mono">{account.appleId ?? '（登录后获取）'}</span>
                <Badge tone={status.tone} dot>
                  {status.label}
                </Badge>
                {account.hasImap &&
                  (account.imapAuthFailed ? (
                    <Badge tone="red">📭 邮箱失效</Badge>
                  ) : (
                    <Badge tone="green">📬 邮箱已连</Badge>
                  ))}
                {account.autoCreateEnabled && <Badge tone="green">⏱ 定时中</Badge>}
                {account.disabled && <Badge tone="gray">⏸ 已停用</Badge>}
              </div>
              <div className="muted text-[13px] mono truncate">更新于 {formatDate(account.updatedAt)}</div>
              {account.lastError && (
                <div className="text-[12px] mt-0.5" style={{ color: 'var(--red)' }}>
                  {account.lastError}
                </div>
              )}
            </div>
            <div className="flex gap-2 flex-wrap justify-end">
              <Button variant="tinted" size="sm" onClick={() => c.openEdit(account)}>
                编辑
              </Button>
              <Button
                variant="tinted"
                size="sm"
                onClick={() => c.openManualCreate(account)}
                disabled={account.status !== 'active' || account.disabled}
                title={account.status !== 'active' ? '账户登录后才能创建别名' : undefined}
              >
                手动创建
              </Button>
              {account.status !== 'awaiting_code' && (
                <Button variant="gray" size="sm" onClick={() => void c.openApplePage(account)}>
                  打开网页
                </Button>
              )}
              <Button
                variant="gray"
                size="sm"
                onClick={() => void c.openRelogin(account)}
                disabled={c.loginBusy}
              >
                {account.status === 'active'
                  ? '刷新'
                  : account.status === 'awaiting_code'
                    ? '继续验证'
                    : '重新登录'}
              </Button>
              <Button variant="gray" size="sm" onClick={() => void c.toggleDisabled(account)}>
                {account.disabled ? '启用' : '停用'}
              </Button>
              <Button variant="danger" size="sm" onClick={() => c.setConfirmDel(account)}>
                删除
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LoginSheet({ controller: c }: { controller: AccountsPageController }) {
  if (!c.loginOpen) return null;
  const credentials = c.loginPhase === 'credentials';
  return (
    <Sheet
      title={credentials ? (c.loginMode === 'new' ? '添加 iCloud 账户' : '重新登录') : '输入短信验证码'}
      footer={
        <>
          <Button
            type="button"
            variant="gray"
            className="flex-1"
            onClick={c.closeLogin}
            disabled={c.loginBusy}
          >
            {credentials ? '取消' : '关闭'}
          </Button>
          <Button
            type="submit"
            form="account-login-form"
            className="flex-1"
            disabled={c.loginBusy || (!credentials && !c.loginCode.trim())}
          >
            {c.loginBusy ? (credentials ? '登录中…' : '验证中…') : credentials ? '登录' : '验证'}
          </Button>
        </>
      }
    >
      <form
        id="account-login-form"
        onSubmit={(event) => {
          event.preventDefault();
          void (credentials ? c.submitCredentials() : c.submitCode());
        }}
      >
        {credentials ? (
          <div className="flex flex-col gap-3">
            <p className="muted text-[13px]">
              Apple ID 密码与下方收件邮箱使用的 App 专用密码不同。登录密码会在当前设备加密保存，
              用于会话过期后自动恢复；可随时在账户编辑中清除。
            </p>
            <Field label="Apple ID">
              <input
                className="input mono"
                type="email"
                autoComplete="username"
                value={c.loginAppleId}
                placeholder="you@icloud.com"
                onChange={(event) => c.setLoginAppleId(event.target.value)}
              />
            </Field>
            <Field label="Apple ID 登录密码">
              <input
                className="input mono"
                type="password"
                autoComplete="current-password"
                value={c.loginPassword}
                onChange={(event) => c.setLoginPassword(event.target.value)}
              />
            </Field>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={c.loginChina}
                onChange={(event) => c.setLoginChina(event.target.checked)}
              />
              中国大陆区账户（icloud.com.cn）— 取消勾选则使用国际区（icloud.com）
            </label>
            <label className="flex items-start gap-2 text-[13px]">
              <input
                className="mt-0.5"
                type="checkbox"
                checked={c.loginRememberPassword}
                onChange={(event) => c.setLoginRememberPassword(event.target.checked)}
              />
              <span>
                保存登录密码用于自动恢复会话
                <span className="muted block text-[12px]">
                  默认开启，密码仅在本机加密保存；关闭后会话过期时需要重新输入。
                </span>
              </span>
            </label>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="muted text-[13px] leading-relaxed">
              {c.loginPhone ? `验证码已发送到手机 ${c.loginPhone}。` : ''}
              输入短信里的验证码即可完成登录。
            </p>
            <Field label="短信验证码">
              <input
                className="input mono"
                value={c.loginCode}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={20}
                autoFocus
                onChange={(event) => c.setLoginCode(event.target.value)}
              />
            </Field>
            {c.loginCodeError && (
              <p className="text-[13px]" role="alert" style={{ color: 'var(--red)' }}>
                {c.loginCodeError}
              </p>
            )}
            <Button
              type="button"
              variant="plain"
              size="sm"
              onClick={() => void c.resendCode()}
              disabled={c.loginBusy}
            >
              {c.loginBusy ? '正在重新发送…' : '没收到？重新发送短信'}
            </Button>
          </div>
        )}
      </form>
    </Sheet>
  );
}

function ManualCreateSheet({ controller: c }: { controller: AccountsPageController }) {
  if (!c.createFor) return null;
  return (
    <Sheet
      title="手动创建隐藏邮箱"
      footer={
        <>
          <Button
            type="button"
            variant="gray"
            className="flex-1"
            onClick={c.closeManualCreate}
            disabled={c.createBusy}
          >
            取消
          </Button>
          <Button type="submit" form="manual-create-form" className="flex-1" disabled={c.createBusy}>
            {c.createBusy ? '创建中…' : '开始创建'}
          </Button>
        </>
      }
    >
      <form
        id="manual-create-form"
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void c.submitManualCreate();
        }}
      >
        <p className="muted text-[13px] break-all">账户：{c.createFor.appleId ?? c.createFor.label}</p>
        <Field label="创建数量（1–25）">
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={1}
            max={25}
            step={1}
            value={c.createCount}
            onChange={(event) => c.setCreateCount(event.target.value)}
          />
        </Field>
        <Field label="别名标签">
          <input
            className="input"
            maxLength={120}
            value={c.createLabel}
            placeholder="如：AI注册"
            onChange={(event) => c.setCreateLabel(event.target.value)}
          />
        </Field>
        <p className="muted text-[12px]">
          Apple 可能限制短时间内的创建数量；部分失败时会保留已经成功创建的地址。
        </p>
      </form>
    </Sheet>
  );
}

function EditAccountSheet({ controller: c }: { controller: AccountsPageController }) {
  const account = c.editFor;
  if (!account) return null;
  return (
    <Sheet
      title="编辑账户"
      footer={
        <>
          <Button variant="gray" className="flex-1" onClick={c.closeEdit} disabled={c.editBusy}>
            取消
          </Button>
          <Button className="flex-1" onClick={() => void c.saveEdit()} disabled={c.editBusy}>
            {c.editBusy ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="list p-3 text-[13px] flex justify-between gap-3">
          <span className="muted whitespace-nowrap">Apple ID</span>
          <span className="mono truncate">{account.appleId ?? '（登录后获取）'}</span>
        </div>
        <div className="list p-3 flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-[14px]">定时创建</div>
            <div className="muted text-[12px]">
              每隔 65 分钟自动生成 5 个标签为「AI注册」的别名；关闭后仍可手动创建。
            </div>
          </div>
          <Switch
            checked={c.editAutoCreate}
            onChange={() => c.setEditAutoCreate(!c.editAutoCreate)}
            label="启用或停用定时创建"
          />
        </div>

        <div className="font-semibold text-[14px]">Apple 登录凭据</div>
        <p className="muted text-[12px] -mt-2">
          用于登录 iCloud 和会话自动恢复，不是收件邮箱的 App 专用密码。
        </p>
        <Field label="更新 Apple ID 登录密码">
          <input
            className="input mono"
            type="password"
            autoComplete="new-password"
            value={c.editPassword}
            placeholder="留空则不修改"
            onChange={(event) => c.setEditPassword(event.target.value)}
          />
        </Field>
        {account.hasPassword && !c.clearPasswordConfirm && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => c.setClearPasswordConfirm(true)}
            disabled={c.editBusy}
          >
            清除已保存的 Apple 登录密码
          </Button>
        )}
        {account.hasPassword && c.clearPasswordConfirm && (
          <div className="card p-3 flex flex-col gap-2">
            <p className="text-[12px]" style={{ color: 'var(--amber)' }}>
              清除后会话仍可继续使用，但过期时需要重新输入密码，并可能再次短信验证。
            </p>
            <div className="flex gap-2">
              <Button
                variant="gray"
                size="sm"
                onClick={() => c.setClearPasswordConfirm(false)}
                disabled={c.editBusy}
              >
                取消
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => void c.confirmClearLoginPassword()}
                disabled={c.editBusy}
              >
                确认清除
              </Button>
            </div>
          </div>
        )}

        <div className="hairline" />
        <div className="font-semibold text-[14px]">收件邮箱（iCloud App 专用密码）</div>
        <p className="muted text-[13px] leading-relaxed -mt-2">
          仅用于通过 IMAP 读取转发到 iCloud 邮箱的邮件，不是 Apple ID 登录密码。 在 Apple 账户页的「登录与安全
          → App 专用密码」生成后填入；服务器地址已内置为{' '}
          <span className="mono">imap.mail.me.com:993 (TLS)</span>。
        </p>
        <div>
          <Button variant="tinted" size="sm" onClick={() => void c.openApplePage(account)}>
            🌐 去创建 App 专用密码
          </Button>
        </div>
        <Field label="IMAP 用户名（iCloud 邮箱，一般无需改）">
          <input
            className="input mono"
            value={c.editMailUser}
            onChange={(event) => c.setEditMailUser(event.target.value)}
          />
        </Field>
        <Field label="App 专用密码（IMAP）">
          <input
            className="input mono"
            type="password"
            autoComplete="off"
            value={c.editMailPass}
            placeholder={account.hasImap ? '已设置 · 重新输入可更新' : 'abcd-efgh-ijkl-mnop'}
            onChange={(event) => c.setEditMailPass(event.target.value)}
          />
        </Field>
        {account.hasImap && (
          <div className="flex flex-wrap gap-2">
            <Button variant="tinted" size="sm" onClick={() => void c.testMail()} disabled={c.editBusy}>
              测试已保存的邮箱
            </Button>
            <Button variant="danger" size="sm" onClick={() => void c.clearMail()} disabled={c.editBusy}>
              清除 App 专用密码
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function LogsSheet({ controller: c }: { controller: AccountsPageController }) {
  if (!c.logsOpen) return null;
  return (
    <Sheet
      title="定时创建日志"
      footer={
        <Button variant="gray" className="flex-1" onClick={() => c.setLogsOpen(false)}>
          关闭
        </Button>
      }
    >
      {c.logsLoading ? (
        <p className="muted text-center py-4" role="status">
          加载中…
        </p>
      ) : c.logs.length === 0 ? (
        <p className="muted text-center py-4 text-[13px]">暂无记录</p>
      ) : (
        <div className="list" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {c.logs.map((log) => (
            <div key={log.id} className="list-row" style={{ padding: '9px 12px' }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold truncate mono text-[13px]">
                    {log.appleId ?? log.accountId}
                  </span>
                  <Badge tone={log.success ? 'green' : 'red'} dot>
                    {log.success ? '成功' : '失败'}
                  </Badge>
                </div>
                <div className="muted text-[12px] truncate mt-0.5">
                  +{log.createdCount} 个{log.errorCount ? ` · ${log.errorCount} 失败` : ''}
                  {log.message ? ` · ${log.message}` : ''}
                </div>
                <div className="subtle text-[11px] mt-0.5">{formatDate(log.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

function DeleteAccountSheet({ controller: c }: { controller: AccountsPageController }) {
  const account = c.confirmDel;
  if (!account) return null;
  return (
    <Sheet
      title="删除账户"
      footer={
        <>
          <Button
            variant="gray"
            className="flex-1"
            onClick={() => c.setConfirmDel(null)}
            disabled={c.deleteBusy}
          >
            取消
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            onClick={() => void c.doDelete()}
            disabled={c.deleteBusy}
          >
            {c.deleteBusy ? '删除中…' : '删除'}
          </Button>
        </>
      }
    >
      <p className="muted text-[14px] text-center">
        删除「{account.appleId ?? account.id}」？
        <br />
        将移除其浏览器配置、保存的凭据与别名缓存。
      </p>
    </Sheet>
  );
}

export function AccountsContent({ controller: c }: { controller: AccountsPageController }) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="iCloud 账户"
        description="连接 Apple ID、配置收件邮箱并管理自动创建。Apple 登录密码和收件用 App 专用密码用途不同，均只在当前设备加密保存。"
        actions={
          <>
            <Button variant="gray" onClick={() => void c.openLogs()}>
              日志
            </Button>
            <Button onClick={c.openAddLogin}>＋ 添加账户</Button>
          </>
        }
      />
      <AccountList controller={c} />
      <LoginSheet controller={c} />
      <ManualCreateSheet controller={c} />
      <LogsSheet controller={c} />
      <DeleteAccountSheet controller={c} />
      <EditAccountSheet controller={c} />
    </div>
  );
}
