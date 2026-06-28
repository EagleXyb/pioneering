#!/bin/bash

# 前后端服务启动脚本（带日志管理）

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_ROOT/apps/backend"
FRONTEND_DIR="$PROJECT_ROOT/apps/web"
LOGS_DIR="$PROJECT_ROOT/logs"

# 创建日志目录
mkdir -p "$LOGS_DIR/backend" "$LOGS_DIR/frontend"

# 日志文件
BACKEND_LOG="$LOGS_DIR/backend/uvicorn.log"
FRONTEND_LOG="$LOGS_DIR/frontend/vite.log"

# 停止已有进程
echo "🛑 停止已有服务..."
pkill -f "uvicorn app.main:app" 2>/dev/null
pkill -f "vite --port 5173" 2>/dev/null
sleep 2

# 启动后端（日志输出到项目 logs 目录）
echo "🚀 启动后端服务 (port 9000)..."
cd "$BACKEND_DIR"
nohup python3 -m uvicorn app.main:app \
  --host 0.0.0.0 \
  --port 9000 \
  --reload \
  > "$BACKEND_LOG" 2>&1 &

# 启动前端（日志输出到项目 logs 目录）
echo "🌐 启动前端服务 (port 5173)..."
cd "$FRONTEND_DIR"
nohup npm run dev -- --port 5173 \
  > "$FRONTEND_LOG" 2>&1 &

sleep 3

# 检查服务状态
echo ""
echo "✅ 服务启动完成！"
echo ""
echo "📋 服务地址："
echo "   后端 API： http://localhost:9000"
echo "   前端 Web： http://localhost:5173"
echo "   API 文档： http://localhost:9000/docs"
echo ""
echo "📁 日志位置："
echo "   后端应用日志： $BACKEND_DIR/logs/agent.log (按日轮转)"
echo "   后端访问日志： $BACKEND_LOG"
echo "   前端开发日志： $FRONTEND_LOG"
echo ""
echo "🔍 快速查看日志："
echo "   后端应用：  tail -f $BACKEND_DIR/logs/agent.log"
echo "   后端访问：  tail -f $BACKEND_LOG"
echo "   前端日志：  tail -f $FRONTEND_LOG"
echo ""
echo "🛑 停止服务："
echo "   pkill -f 'uvicorn app.main:app'"
echo "   pkill -f 'vite --port 5173'"
