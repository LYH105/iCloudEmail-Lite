import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { AppIcon } from '../components/AppIcon';
import type { AppTab } from '../navigation';
import type { OverviewPublic } from '../types';
import { Button, PageHeader, errorMessage } from '../ui';

const EMPTY: OverviewPublic = {
  accounts: { total: 0, active: 0, needsAttention: 0, withImap: 0, paused: 0 },
  aliases: { total: 0, active: 0, used: 0, marked: 0 },
  setup: { hasAccount: false, hasActiveAccount: false, hasMailbox: false },
  jobs: { sessionRefreshMinutes: 0, markScanMinutes: 0 },
};

export function OverviewPage({ onNavigate }: { onNavigate: (tab: AppTab) => void }) {
  const [data, setData] = useState<OverviewPublic>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.overview());
      setError('');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const completed = [data.setup.hasActiveAccount, data.setup.hasMailbox, data.aliases.total > 0].filter(
    Boolean,
  ).length;
  const ready = completed === 3;
  const healthy = data.accounts.needsAttention === 0;

  return (
    <div className="overview-page">
      <PageHeader
        title="概览"
        description="账户、隐藏邮箱与收件状态，一眼掌握。所有数据都留在这台设备上。"
        actions={
          <Button variant="gray" size="sm" onClick={() => void load()} disabled={loading}>
            <AppIcon name="refresh" size={16} />
            {loading ? '更新中…' : '更新状态'}
          </Button>
        }
      />

      <section className="overview-hero">
        <div className="overview-hero-copy">
          <div className="eyebrow">
            <span className={`status-light ${healthy ? 'status-light-ok' : 'status-light-warn'}`} />
            {healthy ? '本地服务运行正常' : `${data.accounts.needsAttention} 个账户需要处理`}
          </div>
          <h2>{ready ? '你的隐私邮箱，尽在掌握' : '三步完成首次设置'}</h2>
          <p>
            {ready
              ? `已管理 ${data.aliases.total} 个隐藏邮箱，其中 ${data.aliases.active} 个当前可用。`
              : '连接 iCloud 账户、配置 App 专用密码，然后同步隐藏邮箱。'}
          </p>
          <div className="overview-hero-actions">
            <Button onClick={() => onNavigate(ready ? 'aliases' : 'accounts')}>
              {ready ? '打开邮箱库' : data.setup.hasAccount ? '继续设置' : '添加 iCloud 账户'}
              <AppIcon name="arrow" size={16} />
            </Button>
            {data.setup.hasMailbox && (
              <Button variant="gray" onClick={() => onNavigate('mail')}>
                查看最近邮件
              </Button>
            )}
          </div>
        </div>
        <div className="overview-hero-mark" aria-hidden="true">
          <span>@</span>
          <AppIcon name="shield" size={40} />
        </div>
      </section>

      {error && (
        <div className="inline-alert" role="alert">
          <AppIcon name="alert" size={18} />
          <span>状态暂时无法更新：{error}</span>
          <button onClick={() => void load()}>重试</button>
        </div>
      )}

      <section className="stat-grid" aria-label="数据概览">
        <Stat label="iCloud 账户" value={data.accounts.total} hint={`${data.accounts.active} 个在线`} />
        <Stat label="隐藏邮箱" value={data.aliases.total} hint={`${data.aliases.active} 个可用`} />
        <Stat label="已投入使用" value={data.aliases.used} hint={`${data.aliases.marked} 个有自动标记`} />
        <Stat label="收件连接" value={data.accounts.withImap} hint="使用 App 专用密码" />
      </section>

      <div className="overview-columns">
        <section className="panel setup-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">首次使用</span>
              <h3>设置进度</h3>
            </div>
            <span className="progress-copy">{completed} / 3</span>
          </div>
          <div className="progress-track" aria-label={`已完成 ${completed} / 3`}>
            <span style={{ width: `${(completed / 3) * 100}%` }} />
          </div>
          <div className="setup-steps">
            <SetupStep
              index={1}
              complete={data.setup.hasActiveAccount}
              title="连接 iCloud 账户"
              description="使用 Apple ID 登录并完成短信验证"
              onClick={() => onNavigate('accounts')}
            />
            <SetupStep
              index={2}
              complete={data.setup.hasMailbox}
              title="连接收件邮箱"
              description="填写 Apple App 专用密码，用于读取验证码"
              onClick={() => onNavigate('accounts')}
            />
            <SetupStep
              index={3}
              complete={data.aliases.total > 0}
              title="同步隐藏邮箱"
              description="把多个账户的别名汇总到一个邮箱库"
              onClick={() => onNavigate('aliases')}
            />
          </div>
        </section>

        <section className="panel quick-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">日常使用</span>
              <h3>快捷入口</h3>
            </div>
          </div>
          <QuickAction
            icon="aliases"
            title="管理隐藏邮箱"
            detail="搜索、筛选、标记和导出"
            onClick={() => onNavigate('aliases')}
          />
          <QuickAction
            icon="mail"
            title="查找验证码"
            detail="汇总所有别名的最近邮件"
            onClick={() => onNavigate('mail')}
          />
          <QuickAction
            icon="accounts"
            title={data.accounts.needsAttention ? '处理账户问题' : '管理账户'}
            detail={
              data.accounts.needsAttention
                ? `${data.accounts.needsAttention} 个账户需要重新登录或检查`
                : '登录状态、收件连接与自动创建'
            }
            tone={data.accounts.needsAttention ? 'warn' : undefined}
            onClick={() => onNavigate('accounts')}
          />
        </section>
      </div>

      <div className="privacy-note">
        <AppIcon name="shield" size={18} />
        <span>本地优先：账户凭据使用设备主密钥加密，服务仅监听 127.0.0.1，不向第三方同步数据。</span>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value.toLocaleString('zh-CN')}</strong>
      <small>{hint}</small>
    </div>
  );
}

function SetupStep({
  index,
  complete,
  title,
  description,
  onClick,
}: {
  index: number;
  complete: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button className="setup-step" onClick={onClick}>
      <span className={`setup-step-index ${complete ? 'is-complete' : ''}`}>
        {complete ? <AppIcon name="check" size={15} /> : index}
      </span>
      <span className="setup-step-copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <span className="setup-step-state">{complete ? '已完成' : '去设置'}</span>
      <AppIcon name="arrow" size={16} />
    </button>
  );
}

function QuickAction({
  icon,
  title,
  detail,
  tone,
  onClick,
}: {
  icon: 'aliases' | 'mail' | 'accounts';
  title: string;
  detail: string;
  tone?: 'warn';
  onClick: () => void;
}) {
  return (
    <button className={`quick-action ${tone ? `quick-action-${tone}` : ''}`} onClick={onClick}>
      <span className="quick-action-icon">
        <AppIcon name={icon} size={19} />
      </span>
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <AppIcon name="arrow" size={16} />
    </button>
  );
}
