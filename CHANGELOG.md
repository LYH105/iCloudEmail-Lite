# Changelog

## 0.3.0

- Redesign the desktop interface around a local health overview, guided first-run setup, responsive navigation, clearer feedback, and accessible dialogs and controls.
- Split the account, alias-library, and mail business logic into feature modules; add configurable 1–25 alias batches, destructive-action confirmation, and explicit Apple password storage controls.
- Add resilient API error handling, stale-key recovery, namespaced and bounded private mail caching, safe email rendering, and user-triggered update checks.
- Replace destructive alias snapshot sync with recoverable tombstones so incomplete Apple responses cannot erase local marks or “used” state.
- Make automatic alias creation opt-in, prevent background SMS challenges, validate Apple wire responses, bound Apple/IMAP requests, and protect the final active write API key.
- Harden Electron with a dynamic loopback port, per-launch HttpOnly authentication, single-instance behavior, startup identity checks, navigation/permission restrictions, log rotation, and master-key recovery protection.
- Upgrade Electron to 44 and `better-sqlite3` to 13, add cross-platform native lock validation, environment diagnostics, lint/format/type/test/build checks, and macOS/Windows release CI.
- Add backend, frontend, migration, API-contract, timeout, cache, and security tests; refresh the English/Chinese documentation and all screenshots from the v0.3 production UI.

## 0.2.1

- Update compatible runtime and build dependencies, including Fastify, IMAPFlow, Playwright, Tailwind CSS, and Rollup platform packages.
- Update GitHub Actions artifact handling to the current Node.js 24-based releases.
- Keep the production dependency audit at zero known vulnerabilities.

## 0.2.0

- Export the currently filtered alias library to an Excel-friendly CSV file.
- Check the latest GitHub Release from the About page and show an update download link.
- Keep CSV exports safe from spreadsheet formula injection.

## 0.1.0

- First public release for Windows x64, macOS Apple Silicon, and macOS Intel.
- Multi-account Hide My Email management, alias library, recent mail, verification-code extraction, automatic marks, and local encrypted storage.
