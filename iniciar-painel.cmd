@echo off
rem Liga o painel da Via Sol: atualiza, prepara e sobe na porta 3100.
rem Para ligar junto com o Windows, ponha um atalho deste arquivo em shell:startup
title Painel Via Sol
cd /d "%~dp0"

echo Buscando atualizacoes...
call git pull
call npm install --no-audit --no-fund

echo Preparando o sistema (leva 1 ou 2 minutos)...
call npm run build

echo.
echo Painel no ar: http://localhost:3100  -  nao feche esta janela.
call npx next start -p 3100
pause
