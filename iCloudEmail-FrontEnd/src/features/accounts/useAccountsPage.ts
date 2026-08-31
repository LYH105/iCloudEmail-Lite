import { useEffect, useState } from 'react';
import { ApiError, api } from '../../api';
import type { AccountPublic, AutoCreateLogPublic } from '../../types';
import { errorMessage, useToast } from '../../ui';
import { parseAliasBatchInput } from './accountLogic';

type LoginPhase = 'credentials' | 'code';

export function useAccountsPage() {
  const toast = useToast();
  const [accounts, setAccounts] = useState<AccountPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDel, setConfirmDel] = useState<AccountPublic | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logs, setLogs] = useState<AutoCreateLogPublic[]>([]);

  const [editFor, setEditFor] = useState<AccountPublic | null>(null);
  const [editMailUser, setEditMailUser] = useState('');
  const [editMailPass, setEditMailPass] = useState('');
  const [editAutoCreate, setEditAutoCreate] = useState(false);
  const [editPassword, setEditPassword] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [clearPasswordConfirm, setClearPasswordConfirm] = useState(false);

  const [createFor, setCreateFor] = useState<AccountPublic | null>(null);
  const [createCount, setCreateCount] = useState('5');
  const [createLabel, setCreateLabel] = useState('AI注册');
  const [createBusy, setCreateBusy] = useState(false);

  const [loginOpen, setLoginOpen] = useState(false);
  const [loginMode, setLoginMode] = useState<'new' | 'existing'>('new');
  const [loginAccountId, setLoginAccountId] = useState<string | null>(null);
  const [loginPhase, setLoginPhase] = useState<LoginPhase>('credentials');
  const [loginAppleId, setLoginAppleId] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginChina, setLoginChina] = useState(true);
  const [loginRememberPassword, setLoginRememberPassword] = useState(true);
  const [loginCode, setLoginCode] = useState('');
  const [loginPhone, setLoginPhone] = useState('');
  const [loginCodeError, setLoginCodeError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  const refresh = async () => {
    try {
      setAccounts((await api.listAccounts()).accounts);
    } catch (error) {
      toast.error(errorMessage(error));
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
    setLoginRememberPassword(true);
    setLoginCode('');
    setLoginPhone('');
    setLoginCodeError('');
  };

  const closeLogin = () => {
    if (loginBusy) return;
    setLoginOpen(false);
  };

  const openAddLogin = () => {
    setLoginMode('new');
    resetLoginForm();
    setLoginOpen(true);
  };

  const openRelogin = async (account: AccountPublic) => {
    setLoginMode('existing');
    setLoginAccountId(account.id);
    setLoginAppleId(account.appleId ?? '');
    setLoginPassword('');
    setLoginChina(account.china);
    setLoginRememberPassword(true);
    setLoginCode('');
    setLoginPhone('');
    setLoginCodeError('');

    if (account.status === 'awaiting_code') {
      setLoginBusy(true);
      try {
        const result = await api.resumeCode(account.id);
        if (result.status === 'active') {
          toast.ok('验证会话已自动恢复');
          await refresh();
          return;
        }
        setLoginPhone(result.phone);
        setLoginPhase('code');
        setLoginOpen(true);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          setLoginPhase('credentials');
          setLoginOpen(true);
          toast.error('原验证码流程已失效，请重新输入 Apple ID 密码');
        } else {
          toast.error(errorMessage(error));
        }
      } finally {
        setLoginBusy(false);
      }
      return;
    }
    if (!account.hasPassword) {
      setLoginPhase('credentials');
      setLoginOpen(true);
      return;
    }
    setLoginBusy(true);
    try {
      const result = await api.relogin(account.id);
      if (result.status === 'active') {
        toast.ok('已重新登录');
        await refresh();
        return;
      }
      setLoginPhone(result.phone);
      setLoginPhase('code');
      setLoginOpen(true);
      toast.ok(`已发送短信验证码到 ${result.phone}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setLoginPhase('credentials');
        setLoginOpen(true);
      } else {
        toast.error(errorMessage(error));
      }
    } finally {
      setLoginBusy(false);
    }
  };

  const loginWithPassword = async (
    accountId: string,
    password: string,
    china: boolean,
    rememberPassword = true,
  ) => {
    const result = await api.relogin(accountId, { password, china, rememberPassword });
    if (result.status === 'active') {
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
    setLoginPhone(result.phone);
    setLoginPhase('code');
    setLoginOpen(true);
    toast.ok(`已发送短信验证码到 ${result.phone}`);
  };

  const submitCredentials = async () => {
    if (!loginAppleId.trim() || !loginPassword) {
      toast.error('请输入 Apple ID 和密码');
      return;
    }
    setLoginBusy(true);
    try {
      if (loginMode === 'new') {
        const result = await api.login({
          appleId: loginAppleId.trim(),
          password: loginPassword,
          china: loginChina,
          rememberPassword: loginRememberPassword,
        });
        if (result.status === 'active') {
          toast.ok('登录成功');
          setLoginOpen(false);
          await refresh();
          return;
        }
        setLoginAccountId(result.accountId);
        setLoginPhone(result.phone);
        setLoginPhase('code');
        toast.ok(`已发送短信验证码到 ${result.phone}`);
      } else if (loginAccountId) {
        await loginWithPassword(loginAccountId, loginPassword, loginChina, loginRememberPassword);
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setLoginBusy(false);
    }
  };

  const submitCode = async () => {
    if (!loginAccountId || !loginCode.trim()) return;
    setLoginBusy(true);
    setLoginCodeError('');
    try {
      const result = await api.verifyCode(loginAccountId, loginCode.trim());
      if (result.status === 'active') {
        toast.ok('登录成功');
        setLoginOpen(false);
        await refresh();
        return;
      }
      setLoginCodeError(result.message);
      setLoginCode('');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setLoginPhase('credentials');
        setLoginCodeError('');
        toast.error('验证码流程已超时，请重新输入密码');
      } else {
        toast.error(errorMessage(error));
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
      const result = await api.resendCode(loginAccountId);
      if (result.status === 'active') {
        toast.ok('验证会话已自动恢复');
        setLoginOpen(false);
        await refresh();
        return;
      }
      setLoginPhone(result.phone);
      setLoginCodeError('');
      toast.ok(`已重新发送短信验证码到 ${result.phone}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setLoginPhase('credentials');
        setLoginCodeError('');
        toast.error('原验证码流程已失效，请重新输入 Apple ID 密码');
      } else {
        toast.error(errorMessage(error));
      }
    } finally {
      setLoginBusy(false);
    }
  };

  const openApplePage = async (account: AccountPublic) => {
    try {
      await api.openAccountPage(account.id);
      toast.ok('已用该账户的会话打开 Apple 账户页，操作完成后关闭该窗口即可');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const openLogs = async () => {
    setLogsOpen(true);
    setLogsLoading(true);
    try {
      setLogs((await api.listAutoCreateLogs()).logs);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setLogsLoading(false);
    }
  };

  const doDelete = async () => {
    if (!confirmDel) return;
    setDeleteBusy(true);
    try {
      await api.deleteAccount(confirmDel.id);
      toast.ok('已删除账户');
      setConfirmDel(null);
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeleteBusy(false);
    }
  };

  const toggleDisabled = async (account: AccountPublic) => {
    try {
      await api.setAccountDisabled(account.id, !account.disabled);
      toast.ok(account.disabled ? '已启用' : '已停用（已从邮箱库与后台任务排除）');
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const openManualCreate = (account: AccountPublic) => {
    setCreateFor(account);
    setCreateCount('5');
    setCreateLabel('AI注册');
  };

  const closeManualCreate = () => {
    if (!createBusy) setCreateFor(null);
  };

  const submitManualCreate = async () => {
    if (!createFor) return;
    const input = parseAliasBatchInput(createCount, createLabel);
    if (!input.ok) {
      toast.error(input.message);
      return;
    }
    setCreateBusy(true);
    try {
      const result = await api.createAliasBatch(createFor.id, input.count, input.label);
      if (result.errors.length === 0) {
        toast.ok(`已为 ${createFor.appleId ?? createFor.label} 创建 ${result.created.length} 个别名`);
        setCreateFor(null);
      } else {
        const firstError = result.errors[0]?.message;
        toast.error(
          `创建完成：成功 ${result.created.length} 个，失败 ${result.errors.length} 个${
            firstError ? `（${firstError}）` : ''
          }`,
        );
      }
    } catch (error) {
      toast.error(`手动创建失败：${errorMessage(error)}`);
    } finally {
      setCreateBusy(false);
    }
  };

  const openEdit = (account: AccountPublic) => {
    setEditFor(account);
    setEditMailUser(account.imapUsername ?? account.appleId ?? '');
    setEditMailPass('');
    setEditAutoCreate(account.autoCreateEnabled);
    setEditPassword('');
    setClearPasswordConfirm(false);
  };

  const closeEdit = () => {
    if (!editBusy) setEditFor(null);
  };

  const saveEdit = async () => {
    if (!editFor) return;
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
        if (payload.imapPassword) {
          try {
            await api.testAccountImap(accountId);
            toast.ok('设置已保存，收件邮箱连接正常');
          } catch (error) {
            toast.error(`设置已保存，但收件邮箱连接失败：${errorMessage(error)}`);
          }
        } else {
          toast.ok('设置已保存');
        }
      }
      setEditFor(null);
      if (newPassword) {
        try {
          await loginWithPassword(accountId, newPassword, china);
        } catch (error) {
          toast.error(`${hasSettingsChange ? '其他设置已保存，但' : ''}重新登录失败：${errorMessage(error)}`);
        }
      }
      await refresh();
    } catch (error) {
      toast.error(`保存失败：${errorMessage(error)}`);
    } finally {
      setEditBusy(false);
    }
  };

  const confirmClearLoginPassword = async () => {
    if (!editFor) return;
    setEditBusy(true);
    try {
      const { account } = await api.updateAccountSettings(editFor.id, { clearLoginPassword: true });
      setEditFor(account);
      setClearPasswordConfirm(false);
      toast.ok('已清除保存的 Apple 登录密码与信任凭据');
      await refresh();
    } catch (error) {
      toast.error(`清除失败：${errorMessage(error)}`);
    } finally {
      setEditBusy(false);
    }
  };

  const testMail = async () => {
    if (!editFor) return;
    setEditBusy(true);
    try {
      await api.testAccountImap(editFor.id);
      toast.ok('已保存的收件邮箱连接正常');
    } catch (error) {
      toast.error(`邮箱连接失败：${errorMessage(error)}`);
    } finally {
      setEditBusy(false);
    }
  };

  const clearMail = async () => {
    if (!editFor) return;
    setEditBusy(true);
    try {
      await api.clearAccountImap(editFor.id);
      toast.ok('已清除 App 专用密码');
      setEditFor(null);
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setEditBusy(false);
    }
  };

  return {
    accounts,
    loading,
    confirmDel,
    setConfirmDel,
    deleteBusy,
    logsOpen,
    setLogsOpen,
    logsLoading,
    logs,
    editFor,
    editMailUser,
    setEditMailUser,
    editMailPass,
    setEditMailPass,
    editAutoCreate,
    setEditAutoCreate,
    editPassword,
    setEditPassword,
    editBusy,
    clearPasswordConfirm,
    setClearPasswordConfirm,
    createFor,
    createCount,
    setCreateCount,
    createLabel,
    setCreateLabel,
    createBusy,
    loginOpen,
    loginMode,
    loginPhase,
    loginAppleId,
    setLoginAppleId,
    loginPassword,
    setLoginPassword,
    loginChina,
    setLoginChina,
    loginRememberPassword,
    setLoginRememberPassword,
    loginCode,
    setLoginCode,
    loginPhone,
    loginCodeError,
    loginBusy,
    openAddLogin,
    closeLogin,
    openRelogin,
    submitCredentials,
    submitCode,
    resendCode,
    openApplePage,
    openLogs,
    doDelete,
    toggleDisabled,
    openManualCreate,
    closeManualCreate,
    submitManualCreate,
    openEdit,
    closeEdit,
    saveEdit,
    confirmClearLoginPassword,
    testMail,
    clearMail,
  };
}

export type AccountsPageController = ReturnType<typeof useAccountsPage>;
