#!/usr/bin/env bash
# =============================================================================
# marketing 自动化常驻运行脚本（Ubuntu Server 24.04）
# 用法:
#   ./run.sh            # 仅启动/重启（假设已 next build 过）
#   ./run.sh --build   # 先 npm install + next build，再启动
# =============================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="marketing"
PORT=9001

echo "==> 工作目录: $APP_DIR"
cd "$APP_DIR"

# 1. 构建（可选）
if [ "${1:-}" = "--build" ]; then
  echo "==> [1/3] 安装依赖并构建生产产物..."
  npm install
  npm run build
else
  echo "==> [1/3] 跳过构建（如需构建请加 --build）"
fi

# 确保 pm2 已安装
if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> pm2 未安装，正在全局安装 (sudo npm i -g pm2)..."
  sudo npm install -g pm2
fi

# 2. 启动或重启
echo "==> [2/3] 启动/重启 $APP_NAME (port $PORT)..."
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME"
else
  pm2 start npm --name "$APP_NAME" -- run start
fi

pm2 save
echo "==> [3/3] 已保存 pm2 进程列表（服务器重启后自动恢复）"

# 3. 健康检查
sleep 3
if curl -fsS "http://127.0.0.1:${PORT}" >/dev/null 2>&1; then
  echo "==> 健康检查通过: http://127.0.0.1:${PORT}"
else
  echo "==> 警告: 本地 $PORT 暂未响应，请查 pm2 logs $APP_NAME"
fi

echo ""
echo "常用命令:"
echo "  pm2 status            # 查看状态"
echo "  pm2 logs $APP_NAME   # 查看日志"
echo "  pm2 restart $APP_NAME # 改代码重新 build 后重启"
echo "  pm2 startup          # 首次部署执行一次，配置开机自启"
