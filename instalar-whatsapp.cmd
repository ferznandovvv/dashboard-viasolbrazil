@echo off
rem ============================================================================
rem  Instala a WA-AKG (gateway de WhatsApp) nesta maquina, ao lado do painel.
rem  Rode uma vez, como administrador (botao direito > Executar como administrador).
rem  Depois, use iniciar-whatsapp.cmd para subir (e ponha um atalho em shell:startup).
rem ============================================================================
setlocal EnableDelayedExpansion
title Instalar WhatsApp (WA-AKG)
cd /d "%~dp0"

set "PASTA=%~dp0..\WA-AKG"
set "PORTA=3200"
set "BANCO=wa_akg"

echo.
echo  === 1/6  Conferindo o que ja existe ===
where node >nul 2>&1 || (echo  Node.js nao encontrado. Instale em https://nodejs.org e rode de novo. & pause & exit /b 1)
where git  >nul 2>&1 || (echo  Git nao encontrado. Instale em https://git-scm.com e rode de novo. & pause & exit /b 1)
where winget >nul 2>&1 || (echo  winget nao encontrado (Windows 10 antigo?). Instale o MariaDB a mao e rode de novo. & pause & exit /b 1)

echo.
echo  === 2/6  Banco de dados (MariaDB, compativel com MySQL) ===
set "SENHA_BANCO="
if exist "%PASTA%\.senha-banco.txt" set /p SENHA_BANCO=<"%PASTA%\.senha-banco.txt"
if "%SENHA_BANCO%"=="" (
  set "SENHA_BANCO=vs%RANDOM%%RANDOM%%RANDOM%"
)
set "MYSQLBIN="
for /d %%D in ("C:\Program Files\MariaDB*") do if exist "%%D\bin\mysql.exe" set "MYSQLBIN=%%D\bin"
if "%MYSQLBIN%"=="" (
  echo  Instalando o MariaDB em silencio. Pode levar alguns minutos...
  winget install --id MariaDB.Server -e --accept-package-agreements --accept-source-agreements --silent --override "/qn SERVICENAME=MariaDB PASSWORD=%SENHA_BANCO% PORT=3306 ADDLOCAL=ALL"
  for /d %%D in ("C:\Program Files\MariaDB*") do if exist "%%D\bin\mysql.exe" set "MYSQLBIN=%%D\bin"
  if "!MYSQLBIN!"=="" (echo  O MariaDB nao foi encontrado depois da instalacao. Veja a janela acima. & pause & exit /b 1)
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
"%MYSQLBIN%\mysql.exe" -uroot -p%SENHA_BANCO% -e "CREATE DATABASE IF NOT EXISTS %BANCO% CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" || (echo  Nao consegui criar o banco. Confira a senha em WA-AKG\.senha-banco.txt & pause & exit /b 1)
echo  Banco "%BANCO%" pronto.

echo.
echo  === 3/6  Baixando a WA-AKG ===
if exist "%PASTA%\package.json" (
  cd /d "%PASTA%"
  git pull --ff-only
) else (
  git clone https://github.com/mrifqidaffaaditya/WA-AKG.git "%PASTA%" || (echo  Falhou ao baixar. & pause & exit /b 1)
  cd /d "%PASTA%"
)

echo.
echo  === 4/6  Configuracao (.env) ===
if not exist ".env" (
  set "SEGREDO="
  for /f %%S in ('node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"') do set "SEGREDO=%%S"
  (
    echo PORT="%PORTA%"
    echo DATABASE_URL="mysql://root:%SENHA_BANCO%@localhost:3306/%BANCO%"
    echo AUTH_SECRET="!SEGREDO!"
    echo BASE_URL="http://localhost:%PORTA%"
    echo NODE_ENV="production"
    echo HOSTNAME="0.0.0.0"
    echo NEXTAUTH_URL="http://localhost:%PORTA%"
    echo AUTH_TRUST_HOST="true"
    echo NEXT_PUBLIC_APP_URL="http://localhost:%PORTA%"
    echo NEXT_PUBLIC_API_URL="http://localhost:%PORTA%/api"
    echo APP_NAME="WhatsApp Via Sol"
    echo NEXT_PUBLIC_SWAGGER_ENABLED="true"
    echo NEXT_PUBLIC_SWAGGER_USERNAME="admin"
    echo NEXT_PUBLIC_SWAGGER_PASSWORD="%SENHA_BANCO%"
    echo BAILEYS_LOG_LEVEL="error"
    echo ENABLE_NOTIFICATIONS="true"
    echo ENABLE_AUTO_UPDATE_CHECK="false"
    echo ENABLE_EXPERIMENTAL_FEATURES="false"
    echo SESSION_TIMEOUT_HOURS="720"
    echo MAX_UPLOAD_SIZE_MB="50"
    echo ENABLE_RATE_LIMITING="false"
    echo TZ="America/Sao_Paulo"
    echo LOCALE="pt-BR"
    echo MEDIA_STORAGE_PATH="uploads"
  ) > .env
  echo  .env criado.
) else (
  echo  .env ja existe, mantido.
)

echo.
echo  === 5/6  Dependencias, banco e build (demora alguns minutos) ===
call npm install --no-audit --no-fund || (echo  npm install falhou. & pause & exit /b 1)
call npm run db:push || (echo  Falhou ao criar as tabelas. Confira o DATABASE_URL no .env & pause & exit /b 1)
call npm run build || (echo  Build falhou. & pause & exit /b 1)

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
echo   Para ligar junto com o Windows: Win+R, shell:startup,
echo   e arraste um atalho de iniciar-whatsapp.cmd para a pasta.
echo  ============================================================
pause
