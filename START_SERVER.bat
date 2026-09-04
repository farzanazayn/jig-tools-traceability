@echo off
echo ================================================
echo  Jig ^& Tools Maintenance Traceability System
echo  Starting backend server...
echo ================================================
echo.
cd /d "%~dp0"

if not exist ".env" (
    echo ERROR: .env not found. Copy .env.example to .env and fill in DATABASE_URL first.
    pause
    exit /b 1
)

if not exist "venv" (
    echo No venv found - creating one...
    python -m venv venv
)

call venv\Scripts\activate.bat
pip install -q -r backend\requirements.txt

python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8101 --reload
pause
