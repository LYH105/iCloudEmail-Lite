import { useEffect, useState } from 'react';
import { api, clearStoredKey, getStoredKey, setStoredKey } from './api';
import { Button, Field, Sidebar, errorMessage, useToast } from './ui';
import { AccountsPage } from './pages/AccountsPage';
import { EmailLibraryPage } from './pages/EmailLibraryPage';
import { MailLibraryPage } from './pages/MailLibraryPage';
import { ApiKeysPage } from './pages/ApiKeysPage';
import { AboutPage } from './pages/AboutPage';

type Tab = 'accounts' | 'aliases' | 'mail' | 'apikeys' | 'about';

const ICONS: Record<Tab, string> = {
  accounts: '👤',
  aliases: '🗂',
  mail: '📬',
  apikeys: '🔑',
  about: 'ℹ️',
};

// Tabs whose page manages its own height and scrolls internally (the list
// scrolls, the page around it doesn't) — everything else scrolls in <main>.
const FULL_HEIGHT_TABS: Tab[] = ['aliases', 'mail'];

export function App() {
  const [ready, setReady] = useState(false);
  const [authDisabled, setAuthDisabled] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<Tab>('accounts');
  // Once opened, keep the mail page mounted while other tabs are active. This
  // preserves its exact scroll position, filters, and open-list state without
  // eagerly pulling mail during application startup.
  const [mailVisited, setMailVisited] = useState(false);

  const selectTab = (next: Tab) => {
    if (next === 'mail') setMailVisited(true);
    setTab(next);
  };

  useEffect(() => {
    api
      .config()
      .then((c) => {
        setAuthDisabled(c.authDisabled);
        setAuthed(c.authDisabled || Boolean(getStoredKey()));
      })
      .catch(() => setAuthed(Boolean(getStoredKey())))
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return <div className="grid h-full place-items-center muted">加载中…</div>;
  }
  if (!authed) return <Gate onReady={() => setAuthed(true)} />;

  const tabs: { value: Tab; label: string }[] = [
    { value: 'accounts', label: '账户' },
    { value: 'aliases', label: '邮箱库' },
    { value: 'mail', label: '最近邮件' },
    ...(authDisabled ? [] : [{ value: 'apikeys' as Tab, label: 'API Key' }]),
    { value: 'about', label: '关于' },
  ];
  const fullHeight = FULL_HEIGHT_TABS.includes(tab);

  return (
    <div className="app-shell">
      <Sidebar
        brand={
          <>
            <div className="sidebar-brand-title">iCloud Hide My Email</div>
            <div className="muted text-[12px] mt-1">多账户 · 邮箱库 · 验证码</div>
          </>
        }
        options={tabs.map((t) => ({ ...t, icon: ICONS[t.value] }))}
        value={tab}
        onChange={selectTab}
        footer={
          !authDisabled && (
            <Button
              variant="gray"
              size="sm"
              className="w-full"
              onClick={() => {
                clearStoredKey();
                setAuthed(false);
              }}
            >
              注销
            </Button>
          )
        }
      />

      {/* Full-height tabs never scroll themselves — only their list does.
          Other tabs scroll normally inside <main> (single scrollbar either way). */}
      <main
        className={`flex-1 min-h-0 ${fullHeight ? 'overflow-hidden' : 'overflow-y-auto'}`}
      >
        <div className={`max-w-[1100px] px-7 py-7 ${fullHeight ? 'h-full' : ''}`}>
          {tab === 'accounts' && <AccountsPage />}
          {tab === 'aliases' && <EmailLibraryPage />}
          {(tab === 'mail' || mailVisited) && (
            <div className={tab === 'mail' ? 'h-full' : 'hidden'}>
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

/** API-key gate (only shown when auth is enabled). */
function Gate({ onReady }: { onReady: () => void }) {
  const toast = useToast();
  const [needsBootstrap, setNeedsBootstrap] = useState<boolean | null>(null);
  const [name, setName] = useState('console');
  const [key, setKey] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .bootstrap()
      .then((r) => setNeedsBootstrap(r.needsBootstrap))
      .catch(() => setNeedsBootstrap(false));
  }, []);

  const createFirst = async () => {
    setBusy(true);
    try {
      const { apiKey } = await api.createFirstKey(name);
      setCreatedKey(apiKey.key);
      setStoredKey(apiKey.key);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full place-items-center px-5">
      <div className="card w-full max-w-[420px] p-6">
        <h2 className="text-[19px] font-bold mb-4">接入 API</h2>
        {needsBootstrap === null && <p className="muted">检测服务状态…</p>}

        {needsBootstrap && !createdKey && (
          <div className="flex flex-col gap-3">
            <p className="muted text-[13px]">尚未创建任何 API Key，创建第一个以保护接口调用。</p>
            <Field label="名称">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Button onClick={createFirst} disabled={busy}>
              创建首个 API Key
            </Button>
          </div>
        )}

        {createdKey && (
          <div className="flex flex-col gap-3">
            <p className="muted text-[13px]">请妥善保存，此 Key 只显示一次：</p>
            <div className="input mono break-all">{createdKey}</div>
            <Button onClick={onReady}>进入管理台</Button>
          </div>
        )}

        {needsBootstrap === false && !createdKey && (
          <div className="flex flex-col gap-3">
            <p className="muted text-[13px]">输入已有的 API Key 以访问。</p>
            <Field label="API Key">
              <input
                className="input mono"
                value={key}
                placeholder="ihme_..."
                onChange={(e) => setKey(e.target.value)}
              />
            </Field>
            <Button
              onClick={() => {
                if (!key.trim()) return;
                setStoredKey(key.trim());
                onReady();
              }}
            >
              进入
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
