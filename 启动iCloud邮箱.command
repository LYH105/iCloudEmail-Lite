#!/bin/bash
# macOS launcher — double-click in Finder (the Windows twin is 启动iCloud邮箱.bat).
# Runs from wherever the repo lives, so the folder can be moved freely.
cd "$(dirname "$0")" || exit 1

# Finder launches inherit a bare PATH; add the usual Node install locations.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v npm >/dev/null 2>&1; then
  echo "未找到 Node.js / npm。请先安装 Node.js ≥ 20：https://nodejs.org/"
  echo "Node.js / npm not found. Install Node.js >= 20 first: https://nodejs.org/"
  read -r -p "按回车键退出… (Press Enter to exit) "
  exit 1
fi

npm run desktop
status=$?
if [ $status -ne 0 ]; then
  echo
  echo "iCloud Email Manager startup failed. Error code: $status"
  read -r -p "按回车键退出… (Press Enter to exit) "
fi
exit $status
