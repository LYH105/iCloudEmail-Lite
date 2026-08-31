import { useState } from 'react';
import { AppIcon } from '../components/AppIcon';
import { fetchLatestRelease, isNewerVersion, type LatestRelease } from '../releaseCheck';
import { Button, PageHeader } from '../ui';

const REPOSITORY_URL = 'https://github.com/LYH105/iCloudEmail-Lite';

export function AboutPage() {
  const [latest, setLatest] = useState<LatestRelease | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [hasChecked, setHasChecked] = useState(false);

  const checkForUpdates = async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    setChecking(true);
    setCheckError('');
    try {
      setLatest(await fetchLatestRelease(controller.signal));
      setHasChecked(true);
    } catch (error) {
      setCheckError(
        controller.signal.aborted
          ? '请求超时，请稍后重试'
          : error instanceof Error
            ? error.message
            : '检查失败',
      );
    } finally {
      window.clearTimeout(timeout);
      setChecking(false);
    }
  };

  const hasUpdate = latest ? isNewerVersion(latest.version, __APP_VERSION__) : false;

  return (
    <div className="about-page max-w-[820px] flex flex-col gap-4">
      <PageHeader title="关于" description="一个本地优先、开源的 iCloud 隐藏邮箱管理工具。" />

      <section className="panel about-identity">
        <div className="brand-mark" aria-hidden="true">
          @
        </div>
        <div className="flex-1 min-w-0">
          <span className="panel-kicker">iCloud Hide My Email</span>
          <h2 className="text-[21px] font-bold tracking-[-0.03em]">Hide My Email Manager</h2>
          <p className="muted text-[12px] mt-1">版本 {__APP_VERSION__} · macOS / Windows</p>
        </div>
        <div className="about-update-state">
          {!hasChecked && !checkError && <span className="muted">按需检查，不在后台联网</span>}
          {hasChecked && latest && !hasUpdate && <span className="about-current">已是最新版</span>}
          {hasUpdate && latest && <span className="about-update">发现 {latest.version}</span>}
          {checkError && <span className="about-update-error">{checkError}</span>}
        </div>
      </section>

      <div className="overview-columns">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">隐私与安全</span>
              <h3>数据由你保管</h3>
            </div>
          </div>
          <div className="about-feature-list">
            <AboutFeature
              icon="shield"
              title="本机加密存储"
              text="账户会话、登录密码和 IMAP 密码使用设备主密钥加密。"
            />
            <AboutFeature
              icon="overview"
              title="仅监听本地地址"
              text="桌面服务绑定 127.0.0.1，不提供公网部署入口。"
            />
            <AboutFeature
              icon="mail"
              title="邮件默认阻止追踪"
              text="查看 HTML 邮件时，外部图片需要你明确允许后才会加载。"
            />
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">项目</span>
              <h3>更新与源码</h3>
            </div>
          </div>
          <p className="muted text-[12px] leading-6 mb-5">
            检查更新时会访问 GitHub Releases；除此之外，应用不会将管理数据发送给项目维护者。
          </p>
          <div className="flex flex-col gap-2">
            {hasUpdate && latest ? (
              <a className="btn btn-filled" href={latest.url} target="_blank" rel="noreferrer">
                下载 {latest.version}
              </a>
            ) : (
              <Button onClick={() => void checkForUpdates()} disabled={checking}>
                {checking ? '检查中…' : '检查更新'}
              </Button>
            )}
            <a className="btn btn-gray" href={REPOSITORY_URL} target="_blank" rel="noreferrer">
              查看 GitHub 项目
            </a>
          </div>
        </section>
      </div>

      <section className="panel about-license">
        <span>MIT License · Copyright © LYH105</span>
        <a href={`${REPOSITORY_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
          查看许可证
        </a>
      </section>
    </div>
  );
}

function AboutFeature({
  icon,
  title,
  text,
}: {
  icon: 'shield' | 'overview' | 'mail';
  title: string;
  text: string;
}) {
  return (
    <div className="about-feature">
      <span>
        <AppIcon name={icon} size={18} />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </div>
  );
}
