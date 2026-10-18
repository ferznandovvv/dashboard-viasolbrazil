@echo off
rem Sobe so a WA-AKG (WhatsApp das lojas) na porta 3200 e a mantem no ar.
rem Normalmente nao precisa: o iniciar-painel.cmd ja liga a WA-AKG junto.
title WhatsApp Via Sol (WA-AKG)
rem
rem Observacao para quem mexer aqui: o Windows le este arquivo enquanto ele roda.
rem Quando ele e atualizado com a janela aberta, o Windows continua lendo da
rem mesma posicao em bytes. Este bloco de comentario tem o tamanho certo para que,
rem nesse caso, a leitura caia no inicio da checagem abaixo e a WA-AKG volte normal.
rem Se for mudar algo acima desta linha, mantenha o total de bytes.
rem -----------------------------------------------
rem Se ja estiver rodando, nao abre de novo: uma segunda copia conectaria os
rem WhatsApps em paralelo e derrubaria a conexao da primeira.
powershell -NoProfile -Command "if ((Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue) -or (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'server.index\.ts' })) { exit 1 } else { exit 0 }"
if errorlevel 1 (
  echo A WA-AKG ja esta rodando neste computador, talvez aberta pelo painel. Esta janela fecha sozinha.
  timeout /t 8 /nobreak >nul
  exit /b 0
)
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
