@echo off
rem ============================================================================
rem  Instala a WA-AKG (gateway de WhatsApp) nesta maquina, ao lado do painel.
rem  Rode uma vez, como administrador (botao direito, Executar como administrador).
rem  Depois, use iniciar-whatsapp.cmd para subir e ponha um atalho em shell:startup.
rem ============================================================================
setlocal EnableDelayedExpansion
title Instalar WhatsApp WA-AKG
cd /d "%~dp0"

set "PASTA=%~dp0..\WA-AKG"
set "PORTA=3200"
set "BANCO=wa_akg"

echo.
echo  === 1/6  Conferindo o que ja existe ===
where node >nul 2>&1
if errorlevel 1 (
  echo  Node.js nao encontrado. Instale em https://nodejs.org e rode de novo.
  goto :erro
)
where git >nul 2>&1
if errorlevel 1 (
  echo  Git nao encontrado. Instale em https://git-scm.com e rode de novo.
  goto :erro
)
where winget >nul 2>&1
if errorlevel 1 (
  echo  winget nao encontrado. Instale o MariaDB a mao em https://mariadb.org/download e rode de novo.
  goto :erro
)
echo  Node, Git e winget encontrados.

echo.
echo  === 2/6  Banco de dados MariaDB, compativel com MySQL ===
set "SENHA_BANCO="
if exist "%PASTA%\.senha-banco.txt" set /p SENHA_BANCO=<"%PASTA%\.senha-banco.txt"
if "%SENHA_BANCO%"=="" set "SENHA_BANCO=vs%RANDOM%%RANDOM%%RANDOM%"
set "MYSQLBIN="
for /d %%D in ("C:\Program Files\MariaDB*") do if exist "%%D\bin\mysql.exe" set "MYSQLBIN=%%D\bin"
if "%MYSQLBIN%"=="" (
  echo  Instalando o MariaDB em silencio. Pode levar alguns minutos...
  winget install --id MariaDB.Server -e --accept-package-agreements --accept-source-agreements --silent --override "/qn SERVICENAME=MariaDB PASSWORD=%SENHA_BANCO% PORT=3306 ADDLOCAL=ALL"
  for /d %%D in ("C:\Program Files\MariaDB*") do if exist "%%D\bin\mysql.exe" set "MYSQLBIN=%%D\bin"
  if "!MYSQLBIN!"=="" (
    echo  O MariaDB nao foi encontrado depois da instalacao. Veja a mensagem acima.
    goto :erro
  )
  if not exist "%PASTA%" mkdir "%PASTA%"
  > "%PASTA%\.senha-banco.txt" echo %SENHA_BANCO%
  echo  MariaDB instalado. A senha do banco ficou em WA-AKG\.senha-banco.txt
) else (
  echo  MariaDB ja instalado em "%MYSQLBIN%"
  if not exist "%PASTA%\.senha-banco.txt" (
    echo  Nao achei a senha do root do MariaDB. Digite-a abaixo.
    set /p SENHA_BANCO=  Senha do root do MariaDB: 
    if not exist "%PASTA%" mkdir "%PASTA%"
    > "%PASTA%\.senha-banco.txt" echo !SENHA_BANCO!
  )
)
net start MariaDB >nul 2>&1
"%MYSQLBIN%\mysql.exe" -uroot -p%SENHA_BANCO% -e "CREATE DATABASE IF NOT EXISTS %BANCO% CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
if errorlevel 1 (
  echo  Nao consegui criar o banco. Confira a senha em WA-AKG\.senha-banco.txt
  goto :erro
)
echo  Banco "%BANCO%" pronto.

echo.
echo  === 3/6  Baixando a WA-AKG ===
if not exist "%PASTA%" mkdir "%PASTA%"
cd /d "%PASTA%"
if not exist "%PASTA%\.git" (
  git init -q
  git remote add origin https://github.com/mrifqidaffaaditya/WA-AKG.git
)
git fetch --depth 1 origin main
if errorlevel 1 (
  echo  Falhou ao baixar a WA-AKG do GitHub. Confira a internet e rode de novo.
  goto :erro
)
git checkout -q -B main origin/main
if errorlevel 1 (
  echo  Falhou ao preparar os arquivos da WA-AKG.
  goto :erro
)
echo  WA-AKG baixada.

echo.
echo  === 4/6  Configuracao .env ===
if exist ".env" (
  echo  .env ja existe, mantido.
) else (
  set "SEGREDO=viasol%RANDOM%%RANDOM%%RANDOM%%RANDOM%%RANDOM%%RANDOM%%RANDOM%%RANDOM%%RANDOM%%RANDOM%"
  > .env echo PORT="%PORTA%"
  >> .env echo DATABASE_URL="mysql://root:%SENHA_BANCO%@localhost:3306/%BANCO%"
  >> .env echo AUTH_SECRET="!SEGREDO!"
  >> .env echo BASE_URL="http://localhost:%PORTA%"
  >> .env echo NODE_ENV="production"
  >> .env echo HOSTNAME="0.0.0.0"
  >> .env echo AUTH_TRUST_HOST="true"
  >> .env echo NEXT_PUBLIC_APP_URL="http://localhost:%PORTA%"
  >> .env echo NEXT_PUBLIC_API_URL="http://localhost:%PORTA%/api"
  >> .env echo APP_NAME="WhatsApp Via Sol"
  >> .env echo NEXT_PUBLIC_SWAGGER_ENABLED="false"
  >> .env echo NEXT_PUBLIC_SWAGGER_USERNAME="admin"
  >> .env echo NEXT_PUBLIC_SWAGGER_PASSWORD="sw%RANDOM%%RANDOM%%RANDOM%"
  >> .env echo BAILEYS_LOG_LEVEL="error"
  >> .env echo ENABLE_NOTIFICATIONS="true"
  >> .env echo ENABLE_AUTO_UPDATE_CHECK="false"
  >> .env echo ENABLE_EXPERIMENTAL_FEATURES="false"
  >> .env echo SESSION_TIMEOUT_HOURS="720"
  >> .env echo MAX_UPLOAD_SIZE_MB="50"
  >> .env echo ENABLE_RATE_LIMITING="false"
  >> .env echo TZ="America/Sao_Paulo"
  >> .env echo LOCALE="pt-BR"
  >> .env echo MEDIA_STORAGE_PATH="uploads"
  echo  .env criado.
)

echo.
echo  === 5/6  Dependencias, tabelas e build. Demora alguns minutos ===
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo  npm install falhou.
  goto :erro
)
call npm run db:push
if errorlevel 1 (
  echo  Falhou ao criar as tabelas. Confira o DATABASE_URL no .env
  goto :erro
)
call npm run build
if errorlevel 1 (
  echo  Build falhou.
  goto :erro
)

echo.
echo  === 6/6  Usuario administrador ===
set "ADMIN_EMAIL="
set /p ADMIN_EMAIL=  Seu e-mail para entrar na WA-AKG: 
set "ADMIN_SENHA="
set /p ADMIN_SENHA=  Uma senha para a WA-AKG: 
call npm run make-admin %ADMIN_EMAIL% %ADMIN_SENHA%

echo.
echo  ============================================================
echo   Pronto. Agora de dois cliques em iniciar-whatsapp.cmd
echo   e abra http://localhost:%PORTA% com o e-mail e a senha acima.
echo.
echo   Para ligar junto com o Windows: rode ligar-com-o-windows.cmd.
echo  ============================================================
pause
exit /b 0

:erro
echo.
echo  A instalacao parou. Tire uma foto desta janela e mande para o Fernando resolver.
pause
exit /b 1
