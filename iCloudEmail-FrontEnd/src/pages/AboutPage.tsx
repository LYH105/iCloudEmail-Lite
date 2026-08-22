import { useCallback, useEffect, useState } from 'react';
import { fetchLatestRelease, isNewerVersion, type LatestRelease } from '../releaseCheck';
import { Button } from '../ui';

const REPOSITORY_URL = 'https://github.com/LYH105/iCloudEmail-Lite';

export function AboutPage() {
  const [latest, setLatest] = useState<LatestRelease | null>(null);
  const [checking, setChecking] = useState(true);
  const [checkError, setCheckError] = useState('');

  const checkForUpdates = useCallback(async (signal?: AbortSignal) => {
    setChecking(true);
    setCheckError('');
    try {
      setLatest(await fetchLatestRelease(signal));
    } catch (error) {
      if (signal?.aborted) return;
      setCheckError(error instanceof Error ? error.message : '检查失败');
    } finally {
      if (!signal?.aborted) setChecking(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void checkForUpdates(controller.signal);
    return () => controller.abort();
  }, [checkForUpdates]);

  const hasUpdate = latest ? isNewerVersion(latest.version, __APP_VERSION__) : false;

  return (
    <div className="flex flex-col gap-5 max-w-[680px]">
      <div>
        <h1 className="text-[24px] font-bold">关于</h1>
        <p className="muted mt-1">iCloud Hide My Email 多账户本地管理工具</p>
      </div>

      <section className="card p-6 flex flex-col gap-4">
        <div>
          <div className="text-[18px] font-semibold">iCloud Email Manager</div>
          <div className="muted text-[13px] mt-1">版本 {__APP_VERSION__}</div>
          <div className="text-[13px] mt-2">
            {checking && <span className="muted">正在检查更新…</span>}
            {!checking && hasUpdate && latest && (
              <span style={{ color: 'var(--green)' }}>发现新版本 {latest.version}</span>
            )}
            {!checking && latest && !hasUpdate && (
              <span style={{ color: 'var(--green)' }}>✓ 已是最新版</span>
            )}
            {!checking && checkError && (
              <span style={{ color: 'var(--amber)' }}>暂时无法检查更新：{checkError}</span>
            )}
          </div>
        </div>
        <p className="text-[14px] leading-7">
          管理多个 Apple ID 的隐藏邮箱别名，在本地统一查看最近邮件、验证码和登录链接。
          账户、密码和邮件数据均保存在当前设备上。
        </p>
        <div className="flex flex-wrap gap-2">
          <a className="btn btn-filled" href={REPOSITORY_URL} target="_blank" rel="noreferrer">
            GitHub 项目主页
          </a>
          {hasUpdate && latest ? (
            <a className="btn btn-gray" href={latest.url} target="_blank" rel="noreferrer">
              下载 {latest.version}
            </a>
          ) : (
            <Button variant="gray" onClick={() => void checkForUpdates()} disabled={checking}>
              {checking ? '检查中…' : '重新检查'}
            </Button>
          )}
          <a className="btn btn-gray" href={`${REPOSITORY_URL}/releases`} target="_blank" rel="noreferrer">
            所有版本
          </a>
        </div>
      </section>

      <section className="card p-6">
        <div className="font-semibold">开源许可</div>
        <p className="muted text-[13px] mt-2">MIT License · Copyright © LYH105</p>
      </section>
    </div>
  );
}
