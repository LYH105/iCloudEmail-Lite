import { useCallback, useEffect, useState } from 'react';
import { AUTH_REQUIRED_EVENT, ApiError, api, clearStoredKey, getStoredKey, setStoredKey } from './api';
import { AppIcon, type AppIconName } from './components/AppIcon';
import type { AppTab } from './navigation';
import { AboutPage } from './pages/AboutPage';
import { AccountsPage } from './pages/AccountsPage';
import { ApiKeysPage } from './pages/ApiKeysPage';
import { EmailLibraryPage } from './pages/EmailLibraryPage';
import { MailLibraryPage } from './pages/MailLibraryPage';
import { OverviewPage } from './pages/OverviewPage';
import { Button, Field, Sidebar, errorMessage, useToast } from './ui';

const FULL_HEIGHT_TABS: AppTab[] = ['aliases', 'mail'];
function tabFromHash(authDisabled = false): AppTab {
  const candidate = window.location.hash.replace(/^#\/?/, '') as AppTab;
  const allowed: AppTab[] = ['overview', 'accounts', 'aliases', 'mail', 'about'];
  if (!authDisabled) allowed.push('apikeys');
  return allowed.includes(candidate) ? candidate : 'overview';
}

export function App() {
  const [ready, setReady] = useState(false);
  const [authDisabled, setAuthDisabled] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<AppTab>(() => tabFromHash());
  const [mailVisited, setMailVisited] = useState(() => tabFromHash() === 'mail');

  const selectTab = (next: AppTab) => {
    if (next === 'mail') setMailVisited(true);
    if (tab !== next) window.location.hash = `/${next}`;
    setTab(next);
  };

  useEffect(() => {
    let active = true;
    const boot = async () => {
      try {
        const runtime = await api.config();
        if (!active) return;
        setAuthDisabled(runtime.authDisabled);
        if (runtime.authDisabled) {
          setTab(tabFromHash(true));
          setAuthed(true);
          return;
        }
        if (!getStoredKey()) {
          setAuthed(false);
          return;
        }

        await api.overview();
        if (active) setAuthed(true);
      } catch (reason) {
        if (!active) return;
        if (reason instanceof ApiError && reason.status === 401) clearStoredKey();
        setAuthed(false);
      } finally {
        if (active) setReady(true);
      }
    };
    void boot();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const syncHash = () => {
      const next = tabFromHash(authDisabled);
      if (next === 'mail') setMailVisited(true);
      setTab(next);
    };
    const requireAuth = () => {
      clearStoredKey();
      setAuthed(false);
    };
    window.addEventListener('hashchange', syncHash);
    window.addEventListener(AUTH_REQUIRED_EVENT, requireAuth);
    return () => {
      window.removeEventListener('hashchange', syncHash);
      window.removeEventListener(AUTH_REQUIRED_EVENT, requireAuth);
    };
  }, [authDisabled]);

  if (!ready) return <LaunchScreen />;
  if (!authed) return <Gate onReady={() => setAuthed(true)} />;

  const tabs: { value: AppTab; label: string; shortLabel: string; icon: AppIconName }[] = [
    { value: 'overview', label: '概览', shortLabel: '概览', icon: 'overview' },
    { value: 'accounts', label: 'iCloud 账户', shortLabel: '账户', icon: 'accounts' },
    { value: 'aliases', label: '隐藏邮箱', shortLabel: '邮箱', icon: 'aliases' },
    { value: 'mail', label: '最近邮件', shortLabel: '邮件', icon: 'mail' },
    ...(authDisabled
      ? []
      : [{ value: 'apikeys' as const, label: 'API 密钥', shortLabel: '密钥', icon: 'apikeys' as const }]),
    { value: 'about', label: '关于', shortLabel: '关于', icon: 'about' },
  ];
  const fullHeight = FULL_HEIGHT_TABS.includes(tab);

  return (
    <div className="app-shell">
      <Sidebar
        brand={
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true">
              @
            </div>
            <div>
              <div className="sidebar-brand-title">Hide My Email</div>
              <div className="sidebar-brand-subtitle">本地隐私邮箱管家</div>
            </div>
          </div>
        }
        options={tabs.map((item) => ({
          ...item,
          icon: <AppIcon name={item.icon} size={19} />,
        }))}
        value={tab}
        onChange={selectTab}
        footer={
          <div className="sidebar-meta">
            <div className="local-status">
              <span />
              仅在本机运行
            </div>
            <div className="sidebar-version">v{__APP_VERSION__}</div>
            {!authDisabled && (
              <Button
                variant="plain"
                size="sm"
                className="sidebar-logout"
                onClick={() => {
                  clearStoredKey();
                  setAuthed(false);
                }}
              >
                退出 API 会话
              </Button>
            )}
          </div>
        }
      />

      <main className={`app-main ${fullHeight ? 'app-main-fixed' : ''}`}>
        <div className={`content-frame ${fullHeight ? 'content-frame-fixed' : ''}`}>
          {tab === 'overview' && <OverviewPage onNavigate={selectTab} />}
          {tab === 'accounts' && <AccountsPage />}
          {tab === 'aliases' && <EmailLibraryPage />}
          {(tab === 'mail' || mailVisited) && (
            <div className={tab === 'mail' ? 'h-full' : 'hidden'} aria-hidden={tab !== 'mail'}>
              <MailLibraryPage />
            </div>
          )}
          {tab === 'apikeys' && <ApiKeysPage />}
          {tab === 'about' && <AboutPage />}
        </div>
      </main>
    </div>
  );
}

function LaunchScreen() {
  return (
    <div className="launch-screen" role="status" aria-live="polite">
      <div className="launch-mark">@</div>
      <strong>Hide My Email</strong>
      <span>正在连接本地服务…</span>
    </div>
  );
}

/** API-key gate, used only by browser/server mode. */
function Gate({ onReady }: { onReady: () => void }) {
  const toast = useToast();
  const [needsBootstrap, setNeedsBootstrap] = useState<boolean | null>(null);
  const [bootstrapError, setBootstrapError] = useState('');
  const [name, setName] = useState('本机浏览器');
  const [key, setKey] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadBootstrap = useCallback(async () => {
    try {
      setNeedsBootstrap((await api.bootstrap()).needsBootstrap);
      setBootstrapError('');
    } catch (reason) {
      setBootstrapError(errorMessage(reason));
    }
  }, []);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  const createFirst = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { apiKey } = await api.createFirstKey(name.trim());
      setCreatedKey(apiKey.key);
      setStoredKey(apiKey.key);
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const enterWithKey = async () => {
    if (!key.trim()) return;
    setBusy(true);
    setStoredKey(key.trim());
    try {
      await api.overview();
      onReady();
    } catch (reason) {
      clearStoredKey();
      toast.error(
        reason instanceof ApiError && reason.status === 401 ? 'API 密钥无效或已被吊销' : errorMessage(reason),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gate-screen">
      <div className="gate-intro">
        <div className="gate-mark">@</div>
        <span className="eyebrow">浏览器模式</span>
        <h1>连接你的本地邮箱管理服务</h1>
        <p>桌面应用无需 API 密钥；从浏览器访问服务时，用密钥保护本机接口。</p>
        <div className="gate-security">
          <AppIcon name="shield" size={18} />
          密钥只保存在当前浏览器中
        </div>
      </div>

      <div className="gate-card">
        {needsBootstrap === null && !bootstrapError && <p className="muted">正在检测服务状态…</p>}
        {bootstrapError && (
          <div className="gate-error" role="alert">
            <strong>无法连接本地服务</strong>
            <span>{bootstrapError}</span>
            <Button variant="gray" onClick={() => void loadBootstrap()}>
              重试
            </Button>
          </div>
        )}

        {needsBootstrap && !createdKey && (
          <form
            className="gate-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createFirst();
            }}
          >
            <div>
              <span className="panel-kicker">首次设置</span>
              <h2>创建第一个 API 密钥</h2>
              <p>创建后请立即保存；完整密钥只显示一次。</p>
            </div>
            <Field label="设备名称">
              <input
                className="input"
                value={name}
                autoComplete="organization-title"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? '创建中…' : '创建并继续'}
            </Button>
          </form>
        )}

        {createdKey && (
          <div className="gate-form">
            <div>
              <span className="panel-kicker">创建成功</span>
              <h2>现在保存这串密钥</h2>
              <p>关闭页面后无法再次查看完整内容。</p>
            </div>
            <div className="secret-value mono">{createdKey}</div>
            <Button onClick={onReady}>我已保存，进入管理台</Button>
          </div>
        )}

        {needsBootstrap === false && !createdKey && (
          <form
            className="gate-form"
            onSubmit={(event) => {
              event.preventDefault();
              void enterWithKey();
            }}
          >
            <div>
              <span className="panel-kicker">安全验证</span>
              <h2>输入 API 密钥</h2>
              <p>验证通过后，当前浏览器会记住这次会话。</p>
            </div>
            <Field label="API 密钥">
              <input
                className="input mono"
                value={key}
                type="password"
                autoComplete="current-password"
                spellCheck={false}
                placeholder="ihme_..."
                onChange={(event) => setKey(event.target.value)}
              />
            </Field>
            <Button type="submit" disabled={busy || !key.trim()}>
              {busy ? '验证中…' : '验证并进入'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
