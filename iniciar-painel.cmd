@echo off
rem Liga o painel da Via Sol na porta 3100 (e o WhatsApp, WA-AKG, na 3200) e o mantem atualizado sozinho:
rem a cada 5 minutos ele confere o GitHub, baixa a versao nova e troca sem precisar fechar nada.
rem Para ligar junto com o Windows, rode ligar-com-o-windows.cmd uma vez.
title Painel e WhatsApp Via Sol
cd /d "%~dp0"
rem Se ja estiver rodando, nao abre de novo (duas copias brigariam pela atualizacao).
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if errorlevel 1 (
  echo O painel ja esta rodando neste computador. Esta janela fecha sozinha.
  timeout /t 8 /nobreak >nul
  exit /b 0
)

echo Buscando atualizacoes...
rem Arquivos que o npm e o Next reescrevem sozinhos travariam o git pull
call git checkout -- tsconfig.json package-lock.json package.json
call git pull --ff-only
call npm install --no-audit --no-fund

node scripts\painel.mjs
pause
