@echo off
rem Faz o painel e o WhatsApp (WA-AKG) ligarem sozinhos quando o Windows entra.
rem Pode rodar de novo quantas vezes quiser: nao duplica os atalhos.
title Ligar com o Windows
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ligar-com-o-windows.ps1"
pause
