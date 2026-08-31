#!/bin/bash
# macOS launcher — double-click in Finder (the Windows twin is 启动iCloud邮箱.bat).
# Runs from wherever the repo lives, so the folder can be moved freely.
cd "$(dirname "$0")" || exit 1

# Finder launches inherit a bare PATH; add the usual Node install locations.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "未找到 Node.js / npm。请先安装 Node.js ≥ 22.12：https://nodejs.org/"
  echo "Node.js / npm not found. Install Node.js >= 22.12 first: https://nodejs.org/"
  read -r -p "按回车键退出… (Press Enter to exit) "
  exit 1
fi

if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)'; then
  echo "当前 Node.js 版本为 $(node -v)，项目要求 22.12 或更高版本。"
  echo "Current Node.js is $(node -v); version 22.12 or newer is required."
  read -r -p "按回车键退出… (Press Enter to exit) "
  exit 1
fi

if [ ! -x "node_modules/.bin/electron" ]; then
  echo "尚未安装项目依赖。请先在此目录运行：npm install"
  echo "Dependencies are missing. Run this first: npm install"
  read -r -p "按回车键退出… (Press Enter to exit) "
  exit 1
fi

npm run doctor || {
  echo "环境检查未通过，请按上方提示修复后重试。"
  read -r -p "按回车键退出… (Press Enter to exit) "
  exit 1
}

npm run desktop
status=$?
if [ $status -ne 0 ]; then
  echo
  echo "iCloud Email Manager startup failed. Error code: $status"
  read -r -p "按回车键退出… (Press Enter to exit) "
fi
exit $status
