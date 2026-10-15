@echo off
rem Liga o painel da Via Sol na porta 3100 e o mantem atualizado sozinho:
rem a cada 5 minutos ele confere o GitHub, baixa a versao nova e troca sem precisar fechar nada.
rem Para ligar junto com o Windows, ponha um atalho deste arquivo em shell:startup
title Painel Via Sol
cd /d "%~dp0"

echo Buscando atualizacoes...
rem Arquivos que o npm e o Next reescrevem sozinhos travariam o git pull
call git checkout -- tsconfig.json package-lock.json package.json
call git pull --ff-only
call npm install --no-audit --no-fund

node scripts\painel.mjs
pause
