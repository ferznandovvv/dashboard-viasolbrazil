# Atualiza a WA-AKG (WhatsApp das lojas) para uma versao do GitHub.
#
# Monta a versao nova numa pasta ao lado (WA-AKG-novo) enquanto a atual continua
# no ar, faz copia do banco e so entao troca: o WhatsApp fica fora por segundos.
# A versao anterior fica guardada em WA-AKG-anterior-<data> e o banco em
# WA-AKG-banco-<data>.sql, para voltar se precisar.
#
# Uso: atualizar-whatsapp.cmd            (versao padrao abaixo)
#      atualizar-whatsapp.cmd v1.7.1     (outra versao)

param([string]$Versao = 'v1.7.0')

$ErrorActionPreference = 'Continue'
$raiz = Split-Path -Parent $PSScriptRoot
$pai = Split-Path -Parent $raiz
$atual = Join-Path $pai 'WA-AKG'
$novo = Join-Path $pai 'WA-AKG-novo'
$data = Get-Date -Format 'yyyyMMdd-HHmm'
$porta = 3200

function Passo($t) { Write-Host ''; Write-Host " === $t ===" }
function Falha($t) {
  Write-Host ''
  Write-Host "  PAROU: $t"
  Write-Host '  A WA-AKG que estava rodando continua como estava.'
  exit 1
}
function WaRodando {
  if (Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue) { return $true }
  return [bool](Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'server.index\.ts' })
}

if (-not (Test-Path (Join-Path $atual '.env'))) { Falha "Nao achei a WA-AKG instalada em $atual" }
$envAtual = Get-Content (Join-Path $atual '.env') -Raw
$pkg = Get-Content (Join-Path $atual 'package.json') -Raw -ErrorAction SilentlyContinue
$versaoAtual = if ($pkg -match '"version"\s*:\s*"([^"]+)"') { $Matches[1] } else { '?' }
Write-Host ''
Write-Host "  WA-AKG instalada: $versaoAtual  ->  vai para: $Versao"
if ("v$versaoAtual" -eq $Versao) { Write-Host '  Ja esta nessa versao. Nada a fazer.'; exit 0 }

# ---------------------------------------------------------------------------
Passo "1/6  Baixando a $Versao (a atual continua no ar)"
if (Test-Path $novo) { Remove-Item $novo -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path $novo) { Falha "Nao consegui apagar a pasta $novo de uma tentativa anterior. Feche o que estiver usando ela." }
git clone --quiet --depth 1 --branch $Versao https://github.com/mrifqidaffaaditya/WA-AKG.git $novo
if ($LASTEXITCODE -ne 0) { Falha "Nao consegui baixar a $Versao do GitHub (confira a internet e o nome da versao)." }

# ---------------------------------------------------------------------------
Passo '2/6  Trazendo a configuracao e as midias da atual'
# Copia so o que nao existe na nova: .env, senha do banco, midias, uploads...
robocopy $atual $novo /E /XC /XN /XO /XD node_modules .next .git /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Falha 'Falhou ao copiar os arquivos da WA-AKG atual.' }
$envNovo = Join-Path $novo '.env'
$txt = Get-Content $envNovo -Raw
if (-not $txt.EndsWith("`n")) { Add-Content -Path $envNovo -Value '' }
foreach ($par in @(
  @('ENABLE_TELEMETRY', 'false'),    # 1.7: nao manda nada para o servidor do autor
  @('DEFAULT_LANGUAGE', 'pt-BR')     # 1.7: tela em portugues
)) {
  if ($txt -notmatch "(?m)^\s*$($par[0])\s*=") {
    Add-Content -Path $envNovo -Value "$($par[0])=`"$($par[1])`""
    Write-Host "  .env: $($par[0])=$($par[1])"
  }
}

# ---------------------------------------------------------------------------
Passo '3/6  Instalando as dependencias (alguns minutos)'
Push-Location $novo
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Pop-Location; Falha 'npm install falhou. Veja a mensagem acima.' }
npx prisma generate
if ($LASTEXITCODE -ne 0) { Pop-Location; Falha 'prisma generate falhou. Veja a mensagem acima.' }

# ---------------------------------------------------------------------------
Passo '4/6  Montando a versao nova (alguns minutos)'
npm run build
$build = $LASTEXITCODE
Pop-Location
if ($build -ne 0) { Falha 'A montagem falhou. Veja a mensagem acima.' }

# ---------------------------------------------------------------------------
Passo '5/6  Copia de seguranca do banco'
$m = [regex]::Match($envAtual, 'DATABASE_URL\s*=\s*"?mysql://([^:]+):([^@]*)@([^:/]+)(?::(\d+))?/([^"?\s]+)')
if (-not $m.Success) { Falha 'Nao entendi o DATABASE_URL do .env para fazer a copia do banco.' }
$dumpExe = $null
foreach ($d in (Get-ChildItem 'C:\Program Files\MariaDB*' -Directory -ErrorAction SilentlyContinue)) {
  foreach ($n in @('mariadb-dump.exe', 'mysqldump.exe')) {
    $c = Join-Path $d.FullName "bin\$n"
    if (-not $dumpExe -and (Test-Path $c)) { $dumpExe = $c }
  }
}
if (-not $dumpExe) { Falha 'Nao achei o mariadb-dump/mysqldump do MariaDB para a copia do banco.' }
$dump = Join-Path $pai "WA-AKG-banco-$data.sql"
$portaDb = if ($m.Groups[4].Value) { $m.Groups[4].Value } else { '3306' }
& $dumpExe "-u$($m.Groups[1].Value)" "-p$([uri]::UnescapeDataString($m.Groups[2].Value))" "-h$($m.Groups[3].Value)" "-P$portaDb" --single-transaction --routines "--result-file=$dump" $m.Groups[5].Value
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $dump) -or (Get-Item $dump).Length -lt 1000) { Falha 'A copia do banco falhou; sem ela eu nao troco.' }
Write-Host "  Banco guardado em $dump"

# ---------------------------------------------------------------------------
Passo '6/6  Trocando (o WhatsApp fica fora por alguns segundos)'
# Janela antiga do iniciar-whatsapp.cmd religaria a versao velha: fecha ela primeiro
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -eq 'cmd.exe' -and $_.CommandLine -match 'iniciar-whatsapp\.cmd' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'server.index\.ts' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

$anterior = "WA-AKG-anterior-$data"
$trocou = $false
for ($i = 0; $i -lt 8 -and -not $trocou; $i++) {
  try { Rename-Item -LiteralPath $atual -NewName $anterior -ErrorAction Stop; $trocou = $true } catch { Start-Sleep -Seconds 1 }
}
if (-not $trocou) {
  Write-Host ''
  Write-Host '  PAROU: a pasta WA-AKG esta presa por algum programa (janela do Explorer ou editor aberto nela?).'
  Write-Host '  A versao nova ficou pronta em WA-AKG-novo. Feche o que estiver usando a pasta e rode de novo.'
  if (-not (WaRodando)) { Start-Process -FilePath (Join-Path $raiz 'iniciar-whatsapp.cmd') -WorkingDirectory $raiz }
  exit 1
}
Rename-Item -LiteralPath $novo -NewName 'WA-AKG'
# Midias que chegaram durante a montagem
robocopy (Join-Path $pai $anterior) $atual /E /XC /XN /XO /XD node_modules .next .git /NFL /NDL /NJH /NJS /NP | Out-Null

# O painel religa a WA-AKG sozinho em ate um minuto. Se ele nao fizer (painel
# antigo, sem essa funcao), liga aqui.
Write-Host '  Esperando a WA-AKG nova subir...'
$subiu = $false
for ($i = 0; $i -lt 45 -and -not $subiu; $i++) { Start-Sleep -Seconds 2; $subiu = WaRodando }
if (-not $subiu) {
  Write-Host '  O painel nao religou; ligando pelo iniciar-whatsapp.cmd.'
  Start-Process -FilePath (Join-Path $raiz 'iniciar-whatsapp.cmd') -WorkingDirectory $raiz
}

Write-Host ''
Write-Host '  ============================================================'
Write-Host "   Pronto: WA-AKG $Versao instalada."
Write-Host ''
Write-Host '   Confira em 2 minutos:'
Write-Host '   1. http://localhost:3200 abre e as sessoes das lojas estao conectadas.'
Write-Host '   2. No painel, CRM > Configurar > Numeros > situacao de uma loja:'
Write-Host '      tem que dizer conectado e webhook ok (ou corrigido agora).'
Write-Host '   3. Mande um oi do seu celular para uma loja e veja chegar no Atendimento.'
Write-Host ''
Write-Host "   Versao anterior guardada em: $anterior"
Write-Host "   Banco guardado em:          WA-AKG-banco-$data.sql"
Write-Host '  ============================================================'
