@echo off
echo ================================================
echo  Jig ^& Tools Maintenance Traceability System
echo  Starting backend server...
echo ================================================
echo.
cd /d "%~dp0"
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8101 --reload
pause
