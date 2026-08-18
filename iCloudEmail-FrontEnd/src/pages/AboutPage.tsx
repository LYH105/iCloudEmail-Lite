const REPOSITORY_URL = 'https://github.com/LYH105/iCloudEmail-Lite';

export function AboutPage() {
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
        </div>
        <p className="text-[14px] leading-7">
          管理多个 Apple ID 的隐藏邮箱别名，在本地统一查看最近邮件、验证码和登录链接。
          账户、密码和邮件数据均保存在当前设备上。
        </p>
        <div className="flex flex-wrap gap-2">
          <a className="btn btn-filled" href={REPOSITORY_URL} target="_blank" rel="noreferrer">
            GitHub 项目主页
          </a>
          <a
            className="btn btn-gray"
            href={`${REPOSITORY_URL}/releases`}
            target="_blank"
            rel="noreferrer"
          >
            检查新版本
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
