@echo off
rem Sobe a WA-AKG (WhatsApp das lojas) na porta 3200 e a mantem no ar: se cair, volta sozinha.
rem Para ligar junto com o Windows, ponha um atalho deste arquivo em shell:startup.
title WhatsApp Via Sol (WA-AKG)
cd /d "%~dp0..\WA-AKG" || (echo Pasta WA-AKG nao encontrada. Rode instalar-whatsapp.cmd primeiro. & pause & exit /b 1)
net start MariaDB >nul 2>&1
set NODE_ENV=production
if not exist "node_modules" (
  echo A WA-AKG ainda nao foi instalada por completo. Rode instalar-whatsapp.cmd primeiro.
  pause
  exit /b 1
)
:loop
echo [%date% %time%] Subindo a WA-AKG em http://localhost:3200
call npx tsx src/server/index.ts
echo [%date% %time%] A WA-AKG parou. Voltando em 10 segundos...
timeout /t 10 /nobreak >nul
goto loop
