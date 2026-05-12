#!/bin/bash
# 修复 macOS Gatekeeper "应用已损坏" 提示
# 原理：移除下载文件的 com.apple.quarantine 扩展属性

set -e

APP_PATH="/Applications/Ora.app"

if [ ! -d "$APP_PATH" ]; then
  echo "❌ 未在 /Applications 找到 Ora.app，请先把 Ora.app 拖进 Applications 文件夹再运行本脚本。"
  read -n 1 -s -r -p "按任意键退出..."
  exit 1
fi

echo "🔧 正在解除 Ora.app 的隔离标记..."
sudo xattr -dr com.apple.quarantine "$APP_PATH"
echo "✅ 完成！现在可以正常打开 Ora 了。"
read -n 1 -s -r -p "按任意键退出..."
