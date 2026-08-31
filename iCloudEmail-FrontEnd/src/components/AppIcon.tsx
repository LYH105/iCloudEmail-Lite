import type { ReactNode, SVGProps } from 'react';

export type AppIconName =
  | 'overview'
  | 'accounts'
  | 'aliases'
  | 'mail'
  | 'apikeys'
  | 'about'
  | 'arrow'
  | 'refresh'
  | 'shield'
  | 'check'
  | 'alert';

const paths: Record<AppIconName, ReactNode> = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  accounts: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  aliases: (
    <>
      <path d="M4 6.5h16v12H4z" />
      <path d="m4.5 7 7.5 6 7.5-6" />
      <path d="M8 4h8" />
    </>
  ),
  mail: (
    <>
      <path d="M4 5h16v14H4z" />
      <path d="m4.5 6 7.5 6 7.5-6" />
      <circle cx="18.5" cy="5.5" r="3.5" className="icon-fill" />
    </>
  ),
  apikeys: (
    <>
      <circle cx="8" cy="12" r="4" />
      <path d="M12 12h9M17 12v3M20 12v2" />
    </>
  ),
  about: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6" />
      <path d="M12 7.25h.01" />
    </>
  ),
  arrow: <path d="m9 18 6-6-6-6" />,
  refresh: (
    <>
      <path d="M20 7v5h-5" />
      <path d="M19 12a7 7 0 1 0-2 5" />
    </>
  ),
  shield: <path d="M12 3 5 6v5c0 4.6 2.9 8 7 10 4.1-2 7-5.4 7-10V6l-7-3Z" />,
  check: <path d="m5 12 4 4L19 6" />,
  alert: (
    <>
      <path d="M12 3 2.8 20h18.4L12 3Z" />
      <path d="M12 9v4M12 16.5h.01" />
    </>
  ),
};

export function AppIcon({
  name,
  size = 20,
  ...props
}: { name: AppIconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
