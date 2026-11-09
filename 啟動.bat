@echo off
cd /d "%~dp0"
python tools\serve.py || py tools\serve.py
pause
