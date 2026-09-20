@echo off
cd /d D:\Project\demo\project_Aisling

echo Starting Aisling Stage...
start "Aisling Stage" cmd /k "cd /d D:\Project\demo\project_Aisling && pnpm dev"

echo Waiting for Vite...
timeout /t 3 /nobreak >nul

echo Starting Aisling Desktop...
start "Aisling Desktop" cmd /k "cd /d D:\Project\demo\project_Aisling && pnpm dev:desktop"

exit