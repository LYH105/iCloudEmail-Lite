<div align="center">

# iCloud Hide My Email Manager

**A cross-platform (macOS / Windows) local desktop app** — multiple Apple IDs, bulk Hide My Email alias management, a cross-alias inbox and verification-code extraction. All data stays on your own machine.

[![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)](#platform-support)
[![Node](https://img.shields.io/badge/Node.js-%E2%89%A5%2020-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![local only](https://img.shields.io/badge/network-127.0.0.1%20only-blue)](#security-notes)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![stars](https://img.shields.io/github/stars/LYH105/iCloudEmail-Lite?style=flat&logo=github&label=Star&color=f5c518)](https://github.com/LYH105/iCloudEmail-Lite/stargazers)

[中文](README.md) · English

**If you find this useful, a ⭐ Star goes a long way** — and makes it easy to find again from "Your stars".

</div>

---

A self-hosted manager for Apple's iCloud Web / Hide My Email (HME) API. It handles multi-account login sessions, alias **generate / reserve / deactivate / reactivate / delete / relabel**, API-key authentication, and pulls verification codes over IMAP. Every request and response field is **matched strictly** against Apple's official web client.

> **This project is built for local desktop use**: the Electron shell starts the backend internally and binds to `127.0.0.1` only. There is nothing to deploy to a server and nothing exposed to the internet.

> Account addresses in the screenshots are demo placeholders.

![Accounts](docs/screenshot-accounts.png)

<details>
<summary>More screenshots (alias library / recent mail)</summary>

**Alias library** — the cross-account alias pool, with search, filtering by account/mark, a "used" toggle and per-alias mail fetch:

![Alias library](docs/screenshot-library.png)

**Recent mail** — one inbox across every alias, each message tagged with its receiving alias and owning account; codes and login links are copyable:

![Recent mail](docs/screenshot-mail.png)

</details>

## Contents

- [Features](#features)
- [Platform support](#platform-support)
- [Getting started](#getting-started)
- [Building installers](#building-installers)
- [Where data is stored](#where-data-is-stored)
- [Authentication: direct SRP-6a login](#authentication-direct-srp-6a-login)
- [Repository layout](#repository-layout)
- [Field alignment with Apple's API](#field-alignment-with-apples-api)
- [This project's REST API](#this-projects-rest-api)
- [Login flow](#login-flow)
- [IMAP verification codes](#imap-verification-codes)
- [Security notes](#security-notes)
- [Troubleshooting](#troubleshooting)
- [Developer self-checks](#developer-self-checks)
- [Support the project](#support-the-project)
- [Disclaimer](#disclaimer)

## Features

- **Desktop app (Electron)**: an iOS 18-style UI (Tailwind) served same-origin by the backend the app starts itself. **No API key needed locally** — double-click and go.
- **Multiple accounts**: SRP login + SMS code. Apple's trust token is stored, so silent re-login without 2FA works for roughly 30 days. When a session expires the app tries, in order: silent cookie refresh → headless re-login with the stored password + trust token → only then does it ask you to verify again. A background session keeper keeps sessions warm.
- **Hide My Email**: `generate` / `reserve` / `list` / `updateMetaData` / `deactivate` / `reactivate` / `delete` / `updateForwardTo`, mirrored into a local cache. **Batch-generate N aliases at once** (default 5); if the session expires mid-batch, cookies are refreshed and the batch continues.
- **Alias library**: a cross-account alias pool with search, filtering by account/mark, a "used" toggle, and per-alias mail fetch. `aliasSyncScheduler` syncs it in the background.
- **Recent mail**: one inbox across every alias (`GET /api/aliases/mail-library`, last 24h by default), each message tagged with the alias it arrived at, refreshed automatically and on demand.
- **Mark rules**: rules on sender/subject that automatically tag aliases (registered / activated / …); `markScanner` scans inboxes on a timer and applies them. Rules can be exported, imported, renamed, and orphaned marks cleaned up.
- **API keys**: stored as SHA-256, with read / write scopes. Creating the very first key is unauthenticated bootstrap.
- **IMAP verification codes**: connects to any IMAP server (iCloud `imap.mail.me.com:993` by default), fetches recent mail and heuristically extracts verification codes / login links, optionally filtered by recipient alias.
- **Encrypted secrets**: session cookies, Apple ID passwords and IMAP passwords are stored AES-256-GCM encrypted in SQLite.

## Platform support

One codebase runs on both macOS and Windows. The differences are exactly these:

|                        | macOS                                               | Windows                                    |
| ---------------------- | --------------------------------------------------- | ------------------------------------------ |
| Requirements           | macOS 11 Big Sur or later (Apple Silicon / Intel)   | Windows 10 (1809) or later, x64            |
| Double-click launcher  | `启动iCloud邮箱.command`                            | `启动iCloud邮箱.bat`                       |
| Data directory         | `~/Library/Application Support/@icloud-hme/desktop` | `%APPDATA%\@icloud-hme\desktop`            |
| Playwright browser     | Google Chrome (`chrome`)                            | Microsoft Edge (`msedge`)                  |
| Packaging              | `npm run dist:mac` → `.dmg` / `.zip`                | `npm run dist:win` → NSIS `.exe` installer |
| Menu bar               | Native menu (⌘C / ⌘V / ⌘Q work)                     | No menu bar; shortcuts live in the window  |

> **Packages must be built on the OS they target.** The app ships a copy of the Node runtime, and `better-sqlite3` is a native module — both are tied to the OS *and* CPU architecture. You cannot build a Windows package on macOS or vice versa, and an Apple Silicon Mac cannot build an Intel package.

## Getting started

### 1. Prerequisites

- **Node.js ≥ 20** ([download](https://nodejs.org/)); on macOS `brew install node` works too.
- A Chromium-based browser: **Google Chrome** on macOS, the built-in **Edge** on Windows. It is only used for cookie refresh and "open page" — login works without it (see [Troubleshooting](#troubleshooting)).
- A compiler toolchain is **usually not needed**: `better-sqlite3` ships prebuilt binaries for macOS (arm64/x64) and Windows (x64). If it does need to compile, install `xcode-select --install` on macOS or the Visual Studio Build Tools ("Desktop development with C++") on Windows.

### 2. Install dependencies

```bash
npm install
```

> ⚠️ **If the repo was copied across operating systems** (e.g. Windows → Mac), `node_modules/` holds the other platform's native binaries and must be removed first:
>
> ```bash
> rm -rf node_modules */node_modules && npm install
> ```
>
> Windows PowerShell: `Remove-Item -Recurse -Force node_modules, */node_modules; npm install`

> 🇨🇳 Downloading Electron's binary can be slow or fail in mainland China; use a mirror:
>
> ```bash
> ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/ npm install
> ```
>
> Windows PowerShell: `$env:ELECTRON_MIRROR="https://registry.npmmirror.com/-/binary/electron/"; npm install`

### 3. Option A — desktop app (recommended)

```bash
npm run desktop      # builds server + web, then opens the Electron window
```

You can also double-click the launcher in your file manager: `启动iCloud邮箱.command` on macOS (you may need `chmod +x 启动iCloud邮箱.command` once) or `启动iCloud邮箱.bat` on Windows.

The desktop app spawns the backend as a system Node child process (fixed at `127.0.0.1:8787`) and loads the UI same-origin into the window. The database, browser profiles and the encryption master key live in the OS userData directory (see [Where data is stored](#where-data-is-stored)); the master key is generated and persisted on first run. Desktop mode is single-user and local, so **no API key is required**.

### 4. Option B — browser dev mode

```bash
npm run dev          # starts backend and frontend together (macOS and Windows alike)
```

Or start them separately:

```bash
npm run dev:server   # backend at http://127.0.0.1:8787
npm run dev:web      # frontend at http://localhost:5173 (proxied to the backend)
```

In browser mode the first visit prompts you to **create the first API key** (that one call is unauthenticated). Every endpoint afterwards needs the key, and the key is shown in plaintext only once, at creation.

Production build: `npm run build` (emits `iCloudEmail-BackEnd/dist` and `iCloudEmail-FrontEnd/dist`). Set `WEB_DIST=../iCloudEmail-FrontEnd/dist` and `npm start` serves both the API and the UI on a single port.

Configuration lives in [`.env.example`](.env.example) (port, master key, session-keeper interval, Playwright channel, …) — copy it to `.env` and edit.

## Building installers

All artifacts land in `release/` at the repository root.

**macOS** (run on a Mac):

```bash
npm run package:mac   # unpacked, runnable app: release/mac-arm64/iCloud Email Manager.app
npm run dist:mac      # .dmg + .zip
```

A locally built package is **not signed with an Apple Developer ID**, so Gatekeeper will block it the first time it is opened (including when you install it from your own .dmg). Two ways around it:

```bash
# after installing, clear the quarantine attribute
xattr -dr com.apple.quarantine "/Applications/iCloud Email Manager.app"
# if macOS still says the app is damaged, ad-hoc sign it
codesign --force --deep --sign - "/Applications/iCloud Email Manager.app"
```

If a certificate in your keychain makes the build itself fail during signing, skip signing: `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac`.

**Windows** (run on Windows):

```powershell
npm run package:win   # portable folder: release\win-unpacked\
npm run dist:win      # NSIS installer: release\iCloud Email Manager Setup 0.1.0.exe
```

## Where data is stored

| What                        | macOS                                                                      | Windows                                                |
| --------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------ |
| SQLite database             | `~/Library/Application Support/@icloud-hme/desktop/data/icloud-hme.sqlite` | `%APPDATA%\@icloud-hme\desktop\data\icloud-hme.sqlite` |
| Browser profiles (per account) | `…/@icloud-hme/desktop/data/profiles/`                                  | `…\@icloud-hme\desktop\data\profiles\`                 |
| Encryption master key       | `…/@icloud-hme/desktop/master.key`                                         | `…\@icloud-hme\desktop\master.key`                     |

- Development runs and installed builds **share the same data**. Uninstalling (NSIS uninstaller, or dragging the .app to the Trash) never removes this directory — delete it by hand when you want a clean slate.
- Browser dev mode (`npm run dev`) does not use userData; its data goes to `iCloudEmail-BackEnd/data/`.
- Backing up means backing up that directory. **Losing `master.key` invalidates every encrypted field** — you would have to log in again and re-enter IMAP passwords.

## Authentication: direct SRP-6a login

The backend implements Apple's **SRP-6a login** ([`iCloudEmail-BackEnd/src/icloud/srp.ts`](iCloudEmail-BackEnd/src/icloud/srp.ts)): enter the Apple ID and password → the server completes the SRP handshake → Apple sends an SMS code → entering the code finishes the login, **with no browser window at any point**. After login it extracts the session cookies and discovers the `premiummailsettings` service URL and `dsid`; every HME operation afterwards talks to the iCloud API directly with those cookies (aligned with [maxktz/icloud-hidemyemail-generator](https://github.com/maxktz/icloud-hidemyemail-generator)).

Playwright appears in exactly two places: the **cookie-refresh fast path** when a session goes stale, and "open page" (opening a signed-in Apple page, e.g. to create an app-specific password).

## Repository layout

```
iCloudEmail-Lite/
├─ iCloudEmail-Desktop/    Electron shell — the app itself, packaged into .app / .exe
│  ├─ main.cjs             window, backend child process, loadURL to the local backend (incl. mac/win differences)
│  ├─ build-icon.icns      macOS app icon
│  ├─ build-icon.ico       Windows app icon
│  └─ scripts/             prepare-runtime.cjs: collects backend/frontend/node output into .runtime before packaging
├─ iCloudEmail-BackEnd/    Backend (Node.js + TypeScript + Fastify + better-sqlite3)
│  ├─ src/
│  │  ├─ config.ts         environment configuration
│  │  ├─ crypto/secrets.ts AES-256-GCM field encryption + API-key hashing
│  │  ├─ db/index.ts       SQLite connection + schema + incremental migrations
│  │  ├─ icloud/
│  │  │  ├─ types.ts       types matched strictly against Apple's API
│  │  │  ├─ srp.ts         SRP-6a login handshake (no browser)
│  │  │  ├─ browser.ts     Playwright: cookie-refresh fast path / open a signed-in page
│  │  │  ├─ hme.ts         HME client (direct, cookie-authenticated)
│  │  │  └─ constants.ts   endpoints / UA / constants
│  │  ├─ imap/             imapflow client + verification-code and login-link extraction
│  │  ├─ services/         accounts / aliases / apiKeys / imap / marks business layer
│  │  │                    + three background schedulers
│  │  └─ api/              Fastify routes + API-key middleware
│  └─ scripts/             browser-check / login-flow-check / api-smoketest (developer self-checks)
├─ iCloudEmail-FrontEnd/   Frontend (React + Vite + TypeScript console)
│  └─ src/pages/           Accounts / Alias library / Recent mail / API keys
└─ scripts/dev.mjs         cross-platform parallel dev launcher (replaces the shell `&`)
```

### Why three directories instead of just "frontend + backend"

They do genuinely different jobs:

- **`iCloudEmail-FrontEnd/`** is the interface (React builds down to static files). It has no idea what a "window" is.
- **`iCloudEmail-BackEnd/`** is the service (Fastify + SQLite). It has no idea what the interface looks like.
- **`iCloudEmail-Desktop/`** is the **shell** that assembles the two: it opens a 1300×920 window, spawns the backend in the background, points the window at `http://127.0.0.1:8787/`, pins data to the OS userData directory, kills the backend on close, and builds the installers with electron-builder. **Without it there is no desktop app** — only "start the backend from a terminal, then type an address into a browser".

The shell also has to be its own npm package: better-sqlite3 is a native module and Electron's main process has a different ABI from Node's, so the backend **does not run inside Electron — it is spawned as a real `node` child process** (with `node` / `node.exe` shipped alongside in packaged builds). That is also why the heavyweight electron / electron-builder dev dependencies must stay isolated in the shell and out of the backend's production dependency tree: packaging copies the backend's dependencies exactly as `npm ls --omit=dev` reports them, and `npmRebuild: false` keeps the native modules on Node's ABI instead of rebuilding them for Electron's.

> The npm package names are still `@icloud-hme/server` / `/web` / `/desktop` (`--workspace` takes package names, not directory names), and the resources inside the installer still use the short names `server/` and `web/`.

## Field alignment with Apple's API

HME requests go to `{webservices.premiummailsettings.url}` with `clientBuildNumber`, `clientMasteringNumber`, `clientId` and `dsid` as query parameters.

| Operation       | Method | Path                      | Body                            | Response                                                        |
| --------------- | ------ | ------------------------- | ------------------------------- | --------------------------------------------------------------- |
| Generate        | POST   | `/v1/hme/generate`        | `{}`                            | `{ success, result: { hme } }`                                  |
| Reserve         | POST   | `/v1/hme/reserve`         | `{ hme, label, note }`          | `{ success, result: { hme: HmeEmail } }`                        |
| List            | GET    | `/v2/hme/list`            | —                              | `{ result: { hmeEmails, selectedForwardTo, forwardToEmails } }` |
| Update metadata | POST   | `/v1/hme/updateMetaData`  | `{ anonymousId, label, note? }` | `{ success }`                                                   |
| Deactivate      | POST   | `/v1/hme/deactivate`      | `{ anonymousId }`               | `{ success }`                                                   |
| Reactivate      | POST   | `/v1/hme/reactivate`      | `{ anonymousId }`               | `{ success }`                                                   |
| Delete          | POST   | `/v1/hme/delete`          | `{ anonymousId }`               | `{ success }`                                                   |
| Forward-to      | POST   | `/v1/hme/updateForwardTo` | `{ forwardToEmail }`            | `{ success }`                                                   |

`HmeEmail` fields (verbatim): `origin`, `anonymousId`, `domain`, `forwardToEmail`, `hme`, `isActive`, `label`, `note`, `createTimestamp`, `recipientMailId`.

Type definitions live in [`iCloudEmail-BackEnd/src/icloud/types.ts`](iCloudEmail-BackEnd/src/icloud/types.ts).

## This project's REST API

Every `/api/*` call needs `Authorization: Bearer <API_KEY>` (or `X-API-Key`). Mutations require the `write` scope, reads require `read`. Desktop mode sets `DISABLE_AUTH=true` and skips auth entirely.

```
GET    /health
GET    /api/config                     # {authDisabled} — is local no-auth mode on (unauthenticated)

GET    /api/apikeys/bootstrap          # {needsBootstrap} — is a first key needed (unauthenticated)
POST   /api/apikeys                    # create a key (unauthenticated bootstrap while none exists)
GET    /api/apikeys
POST   /api/apikeys/:id/revoke
DELETE /api/apikeys/:id

GET    /api/accounts
GET    /api/accounts/:id               # poll this for login progress (status)
POST   /api/accounts/login             # {appleId, password, label?, china?} → {accountId, status:'awaiting_code', phone}
POST   /api/accounts/:id/verify-code   # {code} submit the SMS code, completing login
POST   /api/accounts/:id/resend-code   # resend the code
POST   /api/accounts/:id/resume-code   # resume an interrupted code flow
POST   /api/accounts/:id/relogin       # re-login (with no body: silent re-login via stored password + trust token)
POST   /api/accounts/:id/recover       # recover an expired session: cookie refresh → silent re-login
POST   /api/accounts/:id/settings      # account settings (label, stored password, auto-create aliases, …)
POST   /api/accounts/:id/disabled      # disable/enable this account's background jobs
POST   /api/accounts/:id/open-page     # open a signed-in Apple page with Playwright
POST   /api/accounts/:id/imap          # bind this account's IMAP (app-specific password)
POST   /api/accounts/:id/imap/test
DELETE /api/accounts/:id/imap
DELETE /api/accounts/:id

GET    /api/accounts/:id/aliases                       # local cache
POST   /api/accounts/:id/aliases/sync                  # pull from iCloud and refresh
POST   /api/accounts/:id/aliases/generate              # → {hme}
POST   /api/accounts/:id/aliases/reserve               # {hme, label, note?}
POST   /api/accounts/:id/aliases                       # {label, note?} generate + reserve
POST   /api/accounts/:id/aliases/batch                 # {count, label?, note?} batch generate → {created[], errors[]}
POST   /api/accounts/:id/aliases/forward-to            # {forwardToEmail} change the forwarding target
POST   /api/accounts/:id/aliases/:anonymousId/deactivate
POST   /api/accounts/:id/aliases/:anonymousId/reactivate
PATCH  /api/accounts/:id/aliases/:anonymousId/used     # {used} mark as "used"
GET    /api/accounts/:id/aliases/:anonymousId/mail     # mail for this alias (incl. code/login-link extraction)
POST   /api/accounts/:id/aliases/scan-marks            # scan this account's inbox and apply mark rules
DELETE /api/accounts/:id/aliases/:anonymousId

GET    /api/aliases                     # every alias across accounts (with marks) — the alias library
GET    /api/aliases/mail-library?sinceMinutes=1440   # cross-alias inbox — recent mail
POST   /api/aliases/sync                # sync every account that has mail connected
POST   /api/aliases/scan-marks          # full scan, applying mark rules

GET    /api/mark-rules                  # CRUD for mark rules
POST   /api/mark-rules
PATCH  /api/mark-rules/:id
DELETE /api/mark-rules/:id
GET    /api/mark-rules/orphans          # marks with no matching rule
POST   /api/mark-rules/marks/rename     # {from, to}
DELETE /api/mark-rules/marks/:mark
GET    /api/mark-rules/export           # export / import rules
POST   /api/mark-rules/import

GET    /api/imap
POST   /api/imap                        # {label, host, port?, secure?, username, password, accountId?}
POST   /api/imap/:id/test
GET    /api/imap/:id/codes?sinceMinutes=&limit=&filterTo=
POST   /api/imap/fetch                  # one-shot fetch (credentials are not stored)
DELETE /api/imap/:id

GET    /api/auto-create-logs            # run log for automatic alias creation
```

Example (generate and reserve one alias):

```bash
curl -X POST http://127.0.0.1:8787/api/accounts/$ACCOUNT_ID/aliases \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"label":"Some signup","note":"2026-07"}'
```

In Windows PowerShell use `curl.exe` (`curl` there is an alias for `Invoke-WebRequest`).

## Login flow

1. `POST /api/accounts/login` ("Add account" in the UI: Apple ID + password) → the server completes the **SRP-6a** handshake, Apple sends an SMS code, and the response carries `status: "awaiting_code"` plus the last four digits of the phone number. **No browser window opens.**
2. `POST /api/accounts/:id/verify-code` submits the code (`resend-code` sends a new one) → session cookies and the trust token are captured, `dsid` and the `premiummailsettings` URL are discovered, and the status becomes `active`.
3. From then on every HME operation uses the encrypted, persisted cookies against the iCloud API. On `401/421` the app tries, in order: ① a **silent cookie refresh** through the Playwright persistent profile; ② if a login password was saved under "Edit account", a **headless re-login with password + trust token** (Apple's trust skips 2FA for ~30 days); ③ only if both fail is the account marked `session_expired`, which requires entering an SMS code again.
4. The background session keeper runs that same keep-alive for every account every `SESSION_REFRESH_MINUTES` minutes (default 180), so sessions rarely reach expiry at all.

## IMAP verification codes

- iCloud mailboxes need an **app-specific password** (create one at [appleid.apple.com](https://appleid.apple.com)); the server is `imap.mail.me.com:993` (TLS).
- The extractor scores 4–8 digit candidates, favouring ones near keywords like "verification/code/验证码/OTP", six-digit ones, and ones appearing in the subject. `filterTo` narrows the search to mail sent to a specific alias.

## Security notes

- `SECRET_MASTER_KEY` derives the AES-256-GCM key that encrypts iCloud passwords, sessions and IMAP passwords. **Changing it makes existing ciphertext undecryptable** (you would have to log in / re-enter secrets). Always set a strong random value in production — never the development default.
- The **Apple ID password** you may optionally save under "Edit account" (used for automatic re-login after session expiry) is likewise AES-256-GCM encrypted in the local SQLite database (the desktop master key lives in `master.key` under userData). Desktop mode is single-user and local, which makes that risk acceptable; "clear stored password" is available at any time.
- API keys are stored as SHA-256; the plaintext is returned exactly once, at creation.
- **It listens on `127.0.0.1` only and has no internet-facing component.** All `/api/*` routes require an API key (except in desktop mode, where `DISABLE_AUTH=true`); there is no unauthenticated public entry point.
- `.env` and `data/` (SQLite) are already in `.gitignore` — never commit them.

## Troubleshooting

**macOS: "cannot be opened because the developer cannot be verified" / "is damaged"**
Local builds are unsigned. Run `xattr -dr com.apple.quarantine "/Applications/iCloud Email Manager.app"`, and if that is not enough, `codesign --force --deep --sign - "/Applications/iCloud Email Manager.app"`.

**Double-clicking the `.command` file does nothing / permission denied**
Run `chmod +x 启动iCloud邮箱.command`. If Finder opens it in a text editor instead, right-click → Open With → Terminal.

**Startup dialog: "Node runtime not found"**
A Finder launch in dev mode does not inherit the Homebrew / nvm PATH. If Node is installed but you still see this, run `npm run desktop` from a terminal, or set `NODE_BIN=/opt/homebrew/bin/node`.

**`npm install` fails building better-sqlite3**
Check Node ≥ 20 first, then install `xcode-select --install` (macOS) or the Visual Studio Build Tools with "Desktop development with C++" (Windows) and retry. When a repo has been copied between operating systems, delete `node_modules` first.

**The Electron download hangs / startup says "Electron failed to install correctly"**
Pulling Electron's binary straight from GitHub Releases stalls often on some networks. Reinstall through a mirror:

```bash
ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/ npm install
```

⚠️ **If the previous download was interrupted** (Ctrl-C, dropped connection, timeout), running `npm install` again just prints "up to date" and does nothing — npm considers the dependency tree complete and never re-runs Electron's install script, so `node_modules/electron/dist/` stays empty. Force it:

```bash
npm rebuild electron          # or: rm -rf node_modules/electron && npm install
```

To check that it worked, `ls node_modules/electron/dist` should show `Electron.app` (macOS) or `electron.exe` (Windows) — around 250MB in total.

**Port 8787 already in use**
macOS/Linux: `lsof -i :8787`; Windows: `netstat -ano | findstr 8787`. Or change `PORT` in `.env` (desktop mode honours the `PORT` environment variable).

**Playwright cannot find a browser**
It defaults to the system browser (Edge on Windows, Chrome on macOS) — installing that is enough. To use the bundled Chromium instead: `npx playwright install chromium`, then set `PLAYWRIGHT_CHANNEL=chromium`. Note that login itself needs no browser; only cookie refresh and "open page" do, and "open page" needs a desktop session where you can actually see the window.

## Developer self-checks

```bash
cd iCloudEmail-BackEnd
npx tsx scripts/browser-check.ts     # verify Playwright can launch the local browser (Chrome/Edge/Chromium)
npx tsx scripts/login-flow-check.ts  # exercise the login pipeline without credentials (headless, short timeout — an error is expected)
npx tsx scripts/api-smoketest.ts     # exercise auth/scopes/validation/routes via Fastify inject
```

Type checking: `npm run typecheck`.

## Support the project

This started as a tool I built for myself; it is open source so that anyone with the same need has less to figure out. If it helped you:

- ⭐ **Star the repo** — it takes a second, it is the most tangible encouragement a small project gets, and it helps the next person looking for exactly this actually find it
- 🐛 Hit a rough edge? Open an [issue](https://github.com/LYH105/iCloudEmail-Lite/issues) — bug reports and feature requests are both welcome
- 🔀 Know a better way to do something? PRs are open

<a href="https://github.com/LYH105/iCloudEmail-Lite/stargazers"><img src="https://api.star-history.com/svg?repos=LYH105/iCloudEmail-Lite&type=Date" alt="Star History Chart" width="600"></a>

## Disclaimer

- This is an **unofficial** third-party tool. It is not affiliated with, authorized by, or endorsed by Apple Inc. Apple, iCloud and Hide My Email are trademarks of Apple Inc.
- The HME endpoints are **private** Apple APIs; fields are matched against the behaviour of the official web client (see [maxktz/icloud-hidemyemail-generator](https://github.com/maxktz/icloud-hidemyemail-generator)). Apple's actual responses are the source of truth, and this project may break at any time.
- Shard hostnames like `p68-maildomainws` differ per account, so the `premiummailsettings` service URL is discovered dynamically via `validate` rather than hardcoded.
- Use it only for Apple accounts **you own**. You accept the risk to your accounts (including Apple's anti-abuse measures and terms of service).
- Released under the [MIT License](LICENSE): free to use, modify, distribute and sell, the only condition being that the copyright notice and licence text travel with it. The software is provided "as is", without warranty of any kind.
