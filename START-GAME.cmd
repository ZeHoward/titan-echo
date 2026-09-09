@echo off
cd /d "%~dp0"
echo Titan Echo - Multiplayer Web Game
echo Open http://localhost:4173 in your browser.
echo Keep this window open while playing. Press Ctrl+C to stop.
if exist "runtime\node.exe" (
  "runtime\node.exe" server\standalone.mjs
) else (
  node server\standalone.mjs
)
pause
