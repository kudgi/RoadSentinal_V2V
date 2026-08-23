@echo off
cd /d "%~dp0"
echo Road Sentinel final V2V-SIH simulation
echo Open http://127.0.0.1:8000/final.html
python -m http.server 8000 --bind 127.0.0.1
