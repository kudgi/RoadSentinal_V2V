@echo off
cd /d "%~dp0"
echo Road Sentinel - V2V-SIH visualization
echo Open http://127.0.0.1:8000/
python -m http.server 8000 --bind 127.0.0.1
