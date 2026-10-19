@echo off
REM Awaaz Shield - starts backend and frontend together (Windows). Double-click, or run: start.bat
REM First run installs everything. Close the two windows that open to stop.
cd /d "%~dp0"
where python >nul 2>nul || (echo [!!] python not found. Install Python 3.10+ & pause & exit /b 1)
where npm >nul 2>nul || (echo [!!] npm not found. Install Node.js 18+ & pause & exit /b 1)
if not exist backend\.env copy backend\.env.example backend\.env
if not exist frontend\.env.local copy frontend\.env.example frontend\.env.local
if not exist backend\.venv\Scripts\uvicorn.exe (
  echo [..] first run: installing backend dependencies...
  python -m venv backend\.venv || exit /b 1
  backend\.venv\Scripts\pip install -q -r backend\requirements.txt || exit /b 1
)
if not exist frontend\node_modules (
  echo [..] first run: installing frontend dependencies...
  pushd frontend & call npm install --no-audit --no-fund & popd
)
start "Awaaz Shield backend" cmd /k "cd /d %~dp0backend && .venv\Scripts\uvicorn app.main:app --reload --port 8000"
start "Awaaz Shield frontend" cmd /k "cd /d %~dp0frontend && npm run dev -- --port 5173 --strictPort"
timeout /t 6 >nul
start http://localhost:5173
echo [ok] opened http://localhost:5173
