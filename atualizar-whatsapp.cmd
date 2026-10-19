@echo off
rem Atualiza a WA-AKG (WhatsApp das lojas) para a versao nova do GitHub.
rem Monta ao lado enquanto a atual continua no ar, guarda copia do banco e troca no fim.
rem Uso: dois cliques (versao padrao) ou: atualizar-whatsapp.cmd v1.7.1
title Atualizar WhatsApp (WA-AKG)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\atualizar-whatsapp.ps1" %*
pause
