import { useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import type { AccountPublic, AutoCreateLogPublic } from '../types';
import {
  Badge,
  Button,
  Field,
  PageHeader,
  Sheet,
  Switch,
  errorMessage,
  formatDate,
  useToast,
} from '../ui';

const STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'gray' }> = {
  active: { label: '已登录', tone: 'green' },
  awaiting_code: { label: '等待验证码…', tone: 'amber' },
  session_expired: { label: '会话过期', tone: 'amber' },
  error: { label: '错误', tone: 'red' },
};

type LoginPhase = 'credentials' | 'code';

export function AccountsPage() {
  const toast = useToast();
  const [accounts, setAccounts] = useState<AccountPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDel, setConfirmDel] = useState<AccountPublic | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState<AutoCreateLogPublic[]>([]);
  const [editFor, setEditFor] = useState<AccountPublic | null>(null);
  const [editMailUser, setEditMailUser] = useState('');
  const [editMailPass, setEditMailPass] = useState('');
  const [editAutoCreate, setEditAutoCreate] = useState(false);
  const [editPassword, setEditPassword] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [manualCreating, setManualCreating] = useState<Set<string>>(() => new Set());

  // ---- login sheet (add account / re-login existing) ----
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginMode, setLoginMode] = useState<'new' | 'existing'>('new');
  const [loginAccountId, setLoginAccountId] = useState<string | null>(null);
  const [loginPhase, setLoginPhase] = useState<LoginPhase>('credentials');
  const [loginAppleId, setLoginAppleId] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginChina, setLoginChina] = useState(true);
  const [loginCode, setLoginCode] = useState('');
  const [loginPhone, setLoginPhone] = useState('');
  const [loginCodeError, setLoginCodeError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  const refresh = async () => {
    try {
      setAccounts((await api.listAccounts()).accounts);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const resetLoginForm = () => {
    setLoginAccountId(null);
    setLoginPhase('credentials');
    setLoginAppleId('');
    setLoginPassword('');
    setLoginChina(true);
    setLoginCode('');
    setLoginPhone('');
    setLoginCodeError('');
  };

  const openAddLogin = () => {
    setLoginMode('new');
    resetLoginForm();
    setLoginOpen(true);
  };

  // "重新登录 / 刷新" on an existing account. When a password is already
  // saved, try silently first (no dialog flash unless Apple needs a fresh
  // SMS code or the password no longer works).
  const openRelogin = async (a: AccountPublic) => {
    setLoginMode('existing');
    setLoginAccountId(a.id);
    setLoginAppleId(a.appleId ?? '');
    setLoginPassword('');
    setLoginChina(a.china);
    setLoginCode('');
    setLoginPhone('');
    setLoginCodeError('');

    if (a.status === 'awaiting_code') {
      // The Apple challenge is process-local. Ask the server to reuse it, or
      // transparently rebuild it from the stored password after a restart.
      setLoginBusy(true);
      try {
        const r = await api.resumeCode(a.id);
        if (r.status === 'active') {
          toast.ok('验证会话已自动恢复');
          await refresh();
          return;
        }
        setLoginPhone(r.phone);
        setLoginPhase('code');
        setLoginOpen(true);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          // Accounts created by older versions may not have saved the
          // accepted password before their in-memory challenge disappeared.
          setLoginPhase('credentials');
          setLoginOpen(true);
          toast.error('原验证码流程已失效，请重新输入 Apple ID 密码');
        } else {
          toast.error(errorMessage(e));
        }
      } finally {
        setLoginBusy(false);
      }
      return;
    }
    if (!a.hasPassword) {
      setLoginPhase('credentials');
      setLoginOpen(true);
      return;
    }
    setLoginBusy(true);
    try {
      const r = await api.relogin(a.id);
      if (r.status === 'active') {
        toast.ok('已重新登录');
        await refresh();
        return;
      }
      setLoginPhone(r.phone);
      setLoginPhase('code');
      setLoginOpen(true);
      toast.ok(`已发送短信验证码到 ${r.phone}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setLoginPhase('credentials');
        setLoginOpen(true);
      } else {
        toast.error(errorMessage(e));
      }
    } finally {
      setLoginBusy(false);
    }
  };

  // Re-run login for an existing account with a specific password — shared by
  // the "重新登录" credentials form and by "修改密码" in the edit sheet.
  // Resolves silently on success; opens the SMS-code sheet only if Apple
  // still needs one (fresh password, expired trust token, …).
  const loginWithPassword = async (accountId: string, password: string, china: boolean) => {
    const r = await api.relogin(accountId, { password, china });
    if (r.status === 'active') {
      toast.ok('登录成功');
      setLoginOpen(false);
      await refresh();
      return;
    }
    setLoginMode('existing');
    setLoginAccountId(accountId);
    setLoginChina(china);
    setLoginCode('');
    setLoginCodeError('');
    setLoginPhone(r.phone);
    setLoginPhase('code');
    setLoginOpen(true);
    toast.ok(`已发送短信验证码到 ${r.phone}`);
  };

  const submitCredentials = async () => {
    if (!loginAppleId.trim() || !loginPassword) {
      toast.error('请输入 Apple ID 和密码');
      return;
    }
    setLoginBusy(true);
    try {
      if (loginMode === 'new') {
        const r = await api.login({
          appleId: loginAppleId.trim(),
          password: loginPassword,
          china: loginChina,
        });
        if (r.status === 'active') {
          toast.ok('登录成功');
          setLoginOpen(false);
          await refresh();
          return;
        }
        setLoginAccountId(r.accountId);
        setLoginPhone(r.phone);
        setLoginPhase('code');
        toast.ok(`已发送短信验证码到 ${r.phone}`);
      } else {
        if (!loginAccountId) return;
        await loginWithPassword(loginAccountId, loginPassword, loginChina);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoginBusy(false);
    }
  };

  const submitCode = async () => {
    if (!loginAccountId || !loginCode.trim()) return;
    setLoginBusy(true);
    setLoginCodeError('');
    try {
      const r = await api.verifyCode(loginAccountId, loginCode.trim());
      if (r.status === 'active') {
        toast.ok('登录成功');
        setLoginOpen(false);
        await refresh();
        return;
      }
      setLoginCodeError(r.message);
      setLoginCode('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Pending verification expired server-side — ask for the password again.
        setLoginPhase('credentials');
        setLoginCodeError('');
        toast.error('验证码流程已超时，请重新输入密码');
      } else {
        toast.error(errorMessage(e));
      }
    } finally {
      setLoginBusy(false);
    }
    await refresh();
  };

  const resendCode = async () => {
    if (!loginAccountId) return;
    setLoginBusy(true);
    try {
      const r = await api.resendCode(loginAccountId);
      if (r.status === 'active') {
        toast.ok('验证会话已自动恢复');
        setLoginOpen(false);
        await refresh();
        return;
      }
      setLoginPhone(r.phone);
      setLoginCodeError('');
      toast.ok(`已重新发送短信验证码到 ${r.phone}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setLoginPhase('credentials');
        setLoginCodeError('');
        toast.error('原验证码流程已失效，请重新输入 Apple ID 密码');
      } else {
        toast.error(errorMessage(e));
      }
    } finally {
      setLoginBusy(false);
    }
  };

  // Open a visible browser window on the account's signed-in profile (Apple ID
  // management page — where App-specific passwords are created).
  const openApplePage = async (a: AccountPublic) => {
    try {
      await api.openAccountPage(a.id);
      toast.ok('已用该账户的会话打开 Apple 账户页，操作完成后关闭该窗口即可');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const openLogs = async () => {
    setLogsOpen(true);
    try {
      setLogs((await api.listAutoCreateLogs()).logs);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const doDelete = async () => {
    if (!confirmDel) return;
    try {
      await api.deleteAccount(confirmDel.id);
      toast.ok('已删除');
      setConfirmDel(null);
      await refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const toggleDisabled = async (a: AccountPublic) => {
    try {
      await api.setAccountDisabled(a.id, !a.disabled);
      toast.ok(a.disabled ? '已启用' : '已停用（已从邮箱库与后台任务排除）');
      await refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const createAliasesNow = async (a: AccountPublic) => {
    setManualCreating((current) => new Set(current).add(a.id));
    try {
      const result = await api.createAliasBatch(a.id, 5, 'AI注册');
      if (result.errors.length === 0) {
        toast.ok(`已为 ${a.appleId ?? a.label} 创建 ${result.created.length} 个别名`);
      } else {
        const firstError = result.errors[0]?.message;
        toast.error(
          `手动创建完成：成功 ${result.created.length} 个，失败 ${result.errors.length} 个${
            firstError ? `（${firstError}）` : ''
          }`,
        );
      }
    } catch (e) {
      toast.error(`手动创建失败：${errorMessage(e)}`);
    } finally {
      setManualCreating((current) => {
        const next = new Set(current);
        next.delete(a.id);
        return next;
      });
    }
  };

  const openEdit = (a: AccountPublic) => {
    setEditFor(a);
    setEditMailUser(a.imapUsername ?? a.appleId ?? '');
    setEditMailPass('');
    setEditAutoCreate(a.autoCreateEnabled);
    setEditPassword('');
  };
  const saveEdit = async () => {
    if (!editFor) return;
    // Only send fields the user actually changed / filled in.
    const payload: {
      imapPassword?: string;
      imapUsername?: string;
      autoCreateEnabled?: boolean;
    } = {};
    if (editMailPass.trim()) {
      payload.imapPassword = editMailPass.trim();
      if (editMailUser.trim()) payload.imapUsername = editMailUser.trim();
    }
    if (editAutoCreate !== editFor.autoCreateEnabled) payload.autoCreateEnabled = editAutoCreate;

    const newPassword = editPassword.trim();
    const hasSettingsChange = Object.keys(payload).length > 0;
    if (!hasSettingsChange && !newPassword) {
      setEditFor(null);
      return;
    }
    const accountId = editFor.id;
    const china = editFor.china;
    setEditBusy(true);
    try {
      if (hasSettingsChange) {
        await api.updateAccountSettings(accountId, payload);
        // Verify freshly saved mail credentials before declaring success.
        if (payload.imapPassword) await api.testAccountImap(accountId);
        toast.ok('已保存');
      }
      setEditFor(null);
      if (newPassword) {
        await loginWithPassword(accountId, newPassword, china);
      }
      await refresh();
    } catch (e) {
      toast.error(`保存失败：${errorMessage(e)}`);
    } finally {
      setEditBusy(false);
    }
  };
  const testMail = async () => {
    if (!editFor) return;
    setEditBusy(true);
    try {
      await api.testAccountImap(editFor.id);
      toast.ok('邮箱连接正常');
    } catch (e) {
      toast.error(`邮箱连接失败：${errorMessage(e)}`);
    } finally {
      setEditBusy(false);
    }
  };
  const clearMail = async () => {
    if (!editFor) return;
    setEditBusy(true);
    try {
      await api.clearAccountImap(editFor.id);
      toast.ok('已清除邮箱密码');
      setEditFor(null);
      await refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setEditBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="iCloud 账户"
        description="输入 Apple ID 和密码即可登录（无需打开浏览器）；首次登录需要输入手机短信验证码，之后 Cookie 过期时会用保存的密码自动静默重登。"
        actions={
          <>
            <Button variant="gray" onClick={openLogs}>
              日志
            </Button>
            <Button onClick={openAddLogin}>＋ 添加账户</Button>
          </>
        }
      />

      {loading ? (
        <p className="muted">加载中…</p>
      ) : accounts.length === 0 ? (
        <div className="card p-10 text-center muted">尚无账户 · 点「添加账户」输入 Apple ID 和密码登录</div>
      ) : (
        <div className="list">
          {accounts.map((a) => {
            const st = STATUS[a.status] ?? { label: a.status, tone: 'gray' as const };
            return (
              <div key={a.id} className="list-row" style={{ opacity: a.disabled ? 0.5 : 1 }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold truncate mono">
                      {a.appleId ?? '（登录后获取）'}
                    </span>
                    <Badge tone={st.tone} dot>
                      {st.label}
                    </Badge>
                    {a.hasImap &&
                      (a.imapAuthFailed ? (
                        <Badge tone="red">📭 邮箱失效</Badge>
                      ) : (
                        <Badge tone="green">📬 邮箱已连</Badge>
                      ))}
                    {a.autoCreateEnabled && <Badge tone="green">⏱ 定时中</Badge>}
                    {a.disabled && <Badge tone="gray">⏸ 已停用</Badge>}
                  </div>
                  <div className="muted text-[13px] mono truncate">
                    更新于 {formatDate(a.updatedAt)}
                  </div>
                  {a.lastError && (
                    <div className="text-[12px] mt-0.5" style={{ color: 'var(--red)' }}>
                      {a.lastError}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="tinted" size="sm" onClick={() => openEdit(a)}>
                    编辑
                  </Button>
                  <Button
                    variant="tinted"
                    size="sm"
                    onClick={() => void createAliasesNow(a)}
                    disabled={a.status !== 'active' || a.disabled || manualCreating.has(a.id)}
                    title={a.status !== 'active' ? '账户登录后才能创建别名' : undefined}
                  >
                    {manualCreating.has(a.id) ? '创建中…' : '手动创建'}
                  </Button>
                  {a.status !== 'awaiting_code' && (
                    <Button variant="gray" size="sm" onClick={() => openApplePage(a)}>
                      打开网页
                    </Button>
                  )}
                  <Button variant="gray" size="sm" onClick={() => void openRelogin(a)} disabled={loginBusy}>
                    {a.status === 'active' ? '刷新' : a.status === 'awaiting_code' ? '继续验证' : '重新登录'}
                  </Button>
                  <Button variant="gray" size="sm" onClick={() => void toggleDisabled(a)}>
                    {a.disabled ? '启用' : '停用'}
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => setConfirmDel(a)}>
                    删除
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {loginOpen && (
        <Sheet
          title={loginPhase === 'credentials' ? (loginMode === 'new' ? '添加 iCloud 账户' : '重新登录') : '输入短信验证码'}
          footer={
            loginPhase === 'credentials' ? (
              <>
                <Button variant="gray" className="flex-1" onClick={() => setLoginOpen(false)}>
                  取消
                </Button>
                <Button className="flex-1" onClick={submitCredentials} disabled={loginBusy}>
                  {loginBusy ? '登录中…' : '登录'}
                </Button>
              </>
            ) : (
              <>
                <Button variant="gray" className="flex-1" onClick={() => setLoginOpen(false)}>
                  关闭
                </Button>
                <Button className="flex-1" onClick={submitCode} disabled={loginBusy || !loginCode.trim()}>
                  {loginBusy ? '验证中…' : '验证'}
                </Button>
              </>
            )
          }
        >
          {loginPhase === 'credentials' ? (
            <div className="flex flex-col gap-3">
              <p className="muted text-[13px]">
                密码只用于本机 SRP 计算，加密后与 Apple 的登录信任令牌一并保存，用于日后会话过期时自动静默重登。
              </p>
              <Field label="Apple ID">
                <input
                  className="input mono"
                  value={loginAppleId}
                  placeholder="you@icloud.com"
                  onChange={(e) => setLoginAppleId(e.target.value)}
                />
              </Field>
              <Field label="密码">
                <input
                  className="input mono"
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                />
              </Field>
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={loginChina}
                  onChange={(e) => setLoginChina(e.target.checked)}
                />
                中国大陆区账户（icloud.com.cn）— 取消勾选则使用国际区（icloud.com）
              </label>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="muted text-[13px] leading-relaxed">
                {loginPhone ? `验证码已发送到手机 ${loginPhone}。` : ''}
                输入短信里的验证码即可完成登录；验证成功后本机会被 Apple 记住，之后过期一般无需再次验证。
              </p>
              <Field label="短信验证码">
                <input
                  className="input mono"
                  value={loginCode}
                  autoFocus
                  onChange={(e) => setLoginCode(e.target.value)}
                />
              </Field>
              {loginCodeError && (
                <p className="text-[13px]" style={{ color: 'var(--red)' }}>
                  {loginCodeError}
                </p>
              )}
              <Button variant="plain" size="sm" onClick={resendCode} disabled={loginBusy}>
                {loginBusy ? '正在重新发送…' : '没收到？重新发送短信'}
              </Button>
            </div>
          )}
        </Sheet>
      )}

      {logsOpen && (
        <Sheet
          title="定时创建日志"
          footer={
            <Button variant="gray" className="flex-1" onClick={() => setLogsOpen(false)}>
              关闭
            </Button>
          }
        >
          {logs.length === 0 ? (
            <p className="muted text-center py-4 text-[13px]">暂无记录</p>
          ) : (
            // Scroll the log list on its own so the sheet's 关闭 button stays put
            // instead of being pushed below the fold when there are many rows.
            <div className="list" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {logs.map((l) => (
                <div key={l.id} className="list-row" style={{ padding: '9px 12px' }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold truncate mono text-[13px]">
                        {l.appleId ?? l.accountId}
                      </span>
                      <Badge tone={l.success ? 'green' : 'red'} dot>
                        {l.success ? '成功' : '失败'}
                      </Badge>
                    </div>
                    <div className="muted text-[12px] truncate mt-0.5">
                      +{l.createdCount} 个{l.errorCount ? ` · ${l.errorCount} 失败` : ''}
                      {l.message ? ` · ${l.message}` : ''}
                    </div>
                    <div className="subtle text-[11px] mt-0.5">{formatDate(l.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Sheet>
      )}

      {confirmDel && (
        <Sheet
          title="删除账户"
          footer={
            <>
              <Button variant="gray" className="flex-1" onClick={() => setConfirmDel(null)}>
                取消
              </Button>
              <Button variant="danger" className="flex-1" onClick={doDelete}>
                删除
              </Button>
            </>
          }
        >
          <p className="muted text-[14px] text-center">
            删除「{confirmDel.appleId ?? confirmDel.id}」？<br />
            将移除其浏览器配置、保存的密码与别名缓存。
          </p>
        </Sheet>
      )}

      {editFor && (
        <Sheet
          title="编辑账户"
          footer={
            <>
              <Button variant="gray" className="flex-1" onClick={() => setEditFor(null)}>
                取消
              </Button>
              <Button className="flex-1" onClick={saveEdit} disabled={editBusy}>
                {editBusy ? '保存中…' : '保存'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <div className="list p-3 text-[13px] flex justify-between gap-3">
              <span className="muted whitespace-nowrap">Apple ID</span>
              <span className="mono truncate">{editFor.appleId ?? '（登录后获取）'}</span>
            </div>

            <div className="list p-3 flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-[14px]">定时创建</div>
                <div className="muted text-[12px]">
                  默认开启。每隔 65 分钟（从该账户最新一个别名的创建时间起算）自动生成 5
                  个别名，标签固定为「AI注册」；若账户当前没有别名则立即生成
                </div>
              </div>
              <Switch checked={editAutoCreate} onChange={() => setEditAutoCreate((v) => !v)} />
            </div>

            <Field label="修改密码（Apple ID 密码变更后在此重新输入）">
              <input
                className="input mono"
                type="password"
                value={editPassword}
                placeholder="留空则不修改"
                onChange={(e) => setEditPassword(e.target.value)}
              />
            </Field>

            <div className="hairline" />

            <div className="font-semibold text-[14px]">收件邮箱（App 专用密码）</div>
            <p className="muted text-[13px] leading-relaxed -mt-2">
              用于读取别名转发进来的邮件（IMAP）。点下方按钮用该账户的会话打开 Apple 账户页 →
              登录与安全 → App 专用密码 → 生成后粘贴到下方。服务器{' '}
              <span className="mono">imap.mail.me.com:993 (TLS)</span> 已内置。
            </p>
            <div>
              <Button variant="tinted" size="sm" onClick={() => openApplePage(editFor)}>
                🌐 去创建 App 专用密码
              </Button>
            </div>
            <Field label="IMAP 用户名（iCloud 邮箱，一般无需改）">
              <input
                className="input mono"
                value={editMailUser}
                onChange={(e) => setEditMailUser(e.target.value)}
              />
            </Field>
            <Field label="App 专用密码（IMAP）">
              <input
                className="input mono"
                type="password"
                value={editMailPass}
                placeholder={editFor.hasImap ? '已设置 · 重新输入可更新' : 'abcd-efgh-ijkl-mnop'}
                onChange={(e) => setEditMailPass(e.target.value)}
              />
            </Field>

            {editFor.hasImap && (
              <div className="flex flex-wrap gap-2">
                <Button variant="tinted" size="sm" onClick={testMail} disabled={editBusy}>
                  测试邮箱
                </Button>
                <Button variant="danger" size="sm" onClick={clearMail} disabled={editBusy}>
                  清除邮箱
                </Button>
              </div>
            )}
          </div>
        </Sheet>
      )}
    </div>
  );
}
