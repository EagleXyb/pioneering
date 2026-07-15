# Startup script for Windows - runs each service in a separate hidden process

$PROJECT_ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$BACKEND_DIR = Join-Path $PROJECT_ROOT "apps\backend"
$BACKEND_TS_DIR = Join-Path $PROJECT_ROOT "apps\backend-ts"
$FRONTEND_DIR = Join-Path $PROJECT_ROOT "apps\web"
$MARKETING_DIR = Join-Path $PROJECT_ROOT "apps\marketing"
$DESKTOP_DIR = Join-Path $PROJECT_ROOT "apps\desktop"
$LOGS_DIR = Join-Path $PROJECT_ROOT "logs"

New-Item -ItemType Directory -Force -Path "$LOGS_DIR\backend-ts" | Out-Null
New-Item -ItemType Directory -Force -Path "$LOGS_DIR\frontend" | Out-Null
New-Item -ItemType Directory -Force -Path "$LOGS_DIR\marketing" | Out-Null
New-Item -ItemType Directory -Force -Path "$LOGS_DIR\desktop" | Out-Null

$VENV_PYTHON = Join-Path $BACKEND_DIR "venv\Scripts\python.exe"

# Stop existing services
Write-Host "[1/3] Stopping existing services..."
Get-Process -Name "python","node","electron" -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        $p = Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" -ErrorAction Stop
        if ($p.CommandLine -match 'uvicorn|vite|next|tsx|electron') {
            Write-Host "  Stopping PID $($_.Id)" -NoNewline
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
            Write-Host " [ok]"
        }
    } catch {}
}
Start-Sleep -Seconds 2

Write-Host "[2/3] Starting services..."

# 1. TypeScript Backend (port 6000) — use --experimental-specifier-resolution=node for .js extension interop
$backendTsLog = Join-Path $LOGS_DIR "backend-ts\ts-backend.log"
Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c npm run dev > `"$backendTsLog`" 2>&1" `
    -WorkingDirectory $BACKEND_TS_DIR `
    -WindowStyle Hidden
Write-Host "  Backend-TS (port 6000)"

# 2. Frontend web (port 5173)
$frontendLog = Join-Path $LOGS_DIR "frontend\vite.log"
Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c npm run dev -- --port 5173 > `"$frontendLog`" 2>&1" `
    -WorkingDirectory $FRONTEND_DIR `
    -WindowStyle Hidden
Write-Host "  Frontend  (port 5173)"

# 3. Marketing (port 9001)
$marketingLog = Join-Path $LOGS_DIR "marketing\nextjs.log"
Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c npm run dev > `"$marketingLog`" 2>&1" `
    -WorkingDirectory $MARKETING_DIR `
    -WindowStyle Hidden
Write-Host "  Marketing (port 9001)"

# 4. Desktop (Electron)
$desktopLog = Join-Path $LOGS_DIR "desktop\electron.log"
Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c npm run dev > `"$desktopLog`" 2>&1" `
    -WorkingDirectory $DESKTOP_DIR `
    -WindowStyle Hidden
Write-Host "  Desktop   (Electron)"

Start-Sleep -Seconds 5

Write-Host "[3/3] Checking running processes..."
Get-Process -Name "python","node","electron" -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" -ErrorAction Stop).CommandLine
        if ($cmdLine -match 'uvicorn|vite|next|tsx|electron') {
            Write-Host "  PID $($_.Id) - $($_.ProcessName): running"
        }
    } catch {
        Write-Host "  PID $($_.Id) - $($_.ProcessName): running"
    }
}

Write-Host ""
Write-Host "=== Service URLs ==="
Write-Host "  Backend-TS API: http://localhost:6000"
Write-Host "  API Docs:       http://localhost:6000/docs"
Write-Host "  Frontend Web:   http://localhost:5173"
Write-Host "  Marketing:      http://localhost:9001"
Write-Host "  Desktop:        Electron App (launched separately)"
