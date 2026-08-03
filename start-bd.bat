@echo off
start "" /min cmd /c "cd /d %~dp0apps\backend-ts && npm run dev > %~dp0logs\backend-ts\ts-backend.log 2>&1"
start "" /min cmd /c "cd /d %~dp0apps\desktop && npm run dev > %~dp0logs\desktop\electron.log 2>&1"
start "" /min cmd /c "cd /d %~dp0apps\desktop && npm run dev:browser > %~dp0logs\desktop-browser\browser.log 2>&1"