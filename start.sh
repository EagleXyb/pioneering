#!/bin/bash

# 前后端服务启动脚本（带日志管理）

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_TS_DIR="$PROJECT_ROOT/apps/backend-ts"
FRONTEND_DIR="$PROJECT_ROOT/apps/web"
MARKETING_DIR="$PROJECT_ROOT/apps/marketing"
DESKTOP_DIR="$PROJECT_ROOT/apps/desktop"
LOGS_DIR="$PROJECT_ROOT/logs"

# 创建日志目录
mkdir -p "$LOGS_DIR/backend-ts" "$LOGS_DIR/frontend" "$LOGS_DIR/marketing" "$LOGS_DIR/desktop" "$LOGS_DIR/desktop-browser"

# 日志文件
BACKEND_TS_LOG="$LOGS_DIR/backend-ts/ts-backend.log"
FRONTEND_LOG="$LOGS_DIR/frontend/vite.log"
MARKETING_LOG="$LOGS_DIR/marketing/nextjs.log"
DESKTOP_LOG="$LOGS_DIR/desktop/electron.log"

# 停止已有进程
echo "🛑 停止已有服务..."
pkill -f "tsx watch src/index.ts" 2>/dev/null
pkill -f "vite --port 5173" 2>/dev/null
pkill -f "next dev.*9001" 2>/dev/null
pkill -f "electron" 2>/dev/null
pkill -f "vite --config.*vite.browser.config.ts" 2>/dev/null
pkill -f "port 5175" 2>/dev/null
sleep 2

# 启动 TypeScript 后端（port 6000）
echo "🚀 启动 TS 后端服务 (port 6000)..."
cd "$BACKEND_TS_DIR"
nohup npm run dev \
  > "$BACKEND_TS_LOG" 2>&1 &

# 启动前端（日志输出到项目 logs 目录）
echo "🌐 启动前端 Web 服务 (port 5173)..."
cd "$FRONTEND_DIR"
nohup npm run dev -- --port 5173 \
  > "$FRONTEND_LOG" 2>&1 &

# 启动营销页（Next.js，日志输出到项目 logs 目录）
echo "📊 启动营销页服务 (port 9001)..."
cd "$MARKETING_DIR"
nohup npm run dev \
  > "$MARKETING_LOG" 2>&1 &

# 启动桌面端（Electron）
echo "🖥️ 启动桌面端 (Electron)..."
cd "$DESKTOP_DIR"
nohup npm run dev \
  > "$DESKTOP_LOG" 2>&1 &

# 启动桌面端开发期浏览器预览（port 5175）— 无需 Electron，支持 ?platform=mac|windows|linux
echo "🪟 启动桌面端浏览器预览 (port 5175)..."
DESKTOP_BROWSER_LOG="$LOGS_DIR/desktop-browser/browser.log"
cd "$DESKTOP_DIR"
nohup npm run dev:browser \
  > "$DESKTOP_BROWSER_LOG" 2>&1 &

sleep 3

# 检查服务状态
echo ""
echo "✅ 服务启动完成！"
echo ""
echo "📋 服务地址："
echo "   TS 后端 API： http://localhost:8088"
echo "   前端 Web：    http://localhost:5173"
echo "   营销页：      http://localhost:9001"
echo "   API 文档：    http://localhost:8088/docs"
echo "   桌面端：      Electron App (单独窗口)"
echo "   桌面端预览：  http://localhost:5175"
echo "      - mac:    http://localhost:5175/?platform=mac"
echo "      - windows: http://localhost:5175/?platform=windows"
echo "      - linux:  http://localhost:5175/?platform=linux"
echo ""
echo "📁 日志位置："
echo "   TS 后端日志：  $BACKEND_TS_LOG"
echo "   前端 Web 日志：$FRONTEND_LOG"
echo "   营销页日志：   $MARKETING_LOG"
echo "   桌面端日志：   $DESKTOP_LOG"
echo "   桌面端预览日志：$DESKTOP_BROWSER_LOG"
echo ""
echo "🔍 快速查看日志："
echo "   TS 后端：  tail -f $BACKEND_TS_LOG"
echo "   前端 Web：  tail -f $FRONTEND_LOG"
echo "   营销页：    tail -f $MARKETING_LOG"
echo "   桌面端：    tail -f $DESKTOP_LOG"
echo "   桌面端预览：tail -f $DESKTOP_BROWSER_LOG"
echo ""
echo "🛑 停止服务："
echo "   pkill -f 'tsx watch src/index.ts'"
echo "   pkill -f 'vite --port 5173'"
echo "   pkill -f 'next dev.*9001'"
echo "   pkill -f 'electron'"
echo "   pkill -f 'vite --config.*vite.browser.config.ts'"
