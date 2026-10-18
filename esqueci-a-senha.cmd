@echo off
rem Mostra quem pode entrar no painel e troca a senha de quem esqueceu.
rem So funciona no computador da empresa, onde ficam os dados.
chcp 65001 >nul
title Painel Via Sol - usuarios e senhas
cd /d "%~dp0"
node scripts\acesso.mjs
pause
