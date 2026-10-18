# Faz o painel (que liga a WA-AKG junto) subir sozinho quando o Windows entra.
# Coloca um atalho na pasta Inicializar (shell:startup), sem duplicar, e confere
# se o MariaDB e o tunel do Cloudflare sobem sozinhos.
# Rodado pelo ligar-com-o-windows.cmd. Pode rodar de novo quantas vezes quiser.

$ErrorActionPreference = 'Continue'
$raiz = Split-Path -Parent $PSScriptRoot
$startup = [Environment]::GetFolderPath('Startup')
$shell = New-Object -ComObject WScript.Shell

Write-Host ''
Write-Host ' === Programas que ligam junto com o Windows ==='
$existentes = @(Get-ChildItem -Path $startup -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {
  $l = $shell.CreateShortcut($_.FullName)
  [pscustomobject]@{ Nome = $_.Name; Alvo = $l.TargetPath }
})

# O painel liga a WA-AKG junto (uma janela so). Atalho separado do WhatsApp
# faria as duas tentarem subir ao mesmo tempo no boot, entao sai.
foreach ($e in @($existentes | Where-Object { $_.Alvo -and ((Split-Path -Leaf $_.Alvo) -ieq 'iniciar-whatsapp.cmd') })) {
  Remove-Item -LiteralPath (Join-Path $startup $e.Nome) -ErrorAction SilentlyContinue
  Write-Host "  Tirei o atalho '$($e.Nome)': o painel agora liga o WhatsApp junto."
}

$alvo = Join-Path $raiz 'iniciar-painel.cmd'
$ja = @($existentes | Where-Object { $_.Alvo -and ((Split-Path -Leaf $_.Alvo) -ieq 'iniciar-painel.cmd') })
if (-not (Test-Path $alvo)) {
  Write-Host "  iniciar-painel.cmd nao encontrado em $raiz"
} elseif ($ja.Count -gt 0) {
  Write-Host "  Painel + WhatsApp: ja ligam com o Windows (atalho '$($ja[0].Nome)')"
  foreach ($extra in ($ja | Select-Object -Skip 1)) {
    Remove-Item -LiteralPath (Join-Path $startup $extra.Nome) -ErrorAction SilentlyContinue
    Write-Host "  Tirei o atalho repetido '$($extra.Nome)'."
  }
} else {
  $lnk = $shell.CreateShortcut((Join-Path $startup 'Painel Via Sol.lnk'))
  $lnk.TargetPath = $alvo
  $lnk.WorkingDirectory = $raiz
  $lnk.WindowStyle = 7   # abre minimizado
  $lnk.Save()
  Write-Host '  Painel + WhatsApp: pronto, ligam juntos com o Windows'
}

Write-Host ''
Write-Host ' === Servicos do Windows ==='
foreach ($s in @(
  @{ Nome = 'MariaDB'; Para = 'banco da WA-AKG' },
  @{ Nome = 'cloudflared'; Para = 'tunel dos links painel. e whatsapp.' }
)) {
  $svc = Get-Service -Name $s.Nome -ErrorAction SilentlyContinue
  if (-not $svc) { Write-Host "  $($s.Nome) ($($s.Para)): nao encontrei esse servico nesta maquina"; continue }
  if ($svc.StartType -ne 'Automatic') {
    try {
      Set-Service -Name $s.Nome -StartupType Automatic -ErrorAction Stop
      Write-Host "  $($s.Nome) ($($s.Para)): agora liga sozinho"
    } catch {
      Write-Host "  $($s.Nome) ($($s.Para)): esta como '$($svc.StartType)'. Rode este arquivo como administrador para corrigir."
    }
  } else {
    Write-Host "  $($s.Nome) ($($s.Para)): ok, liga sozinho"
  }
}

Write-Host ''
Write-Host ' Os atalhos so rodam quando alguem entra no Windows. Se este computador pede'
Write-Host ' senha ao ligar, o painel e o WhatsApp so sobem depois que alguem entrar.'
Write-Host ''
