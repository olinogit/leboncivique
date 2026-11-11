<#
.SYNOPSIS
  Déploiement local de Le bon civique (Windows / PowerShell).

.EXAMPLE
  .\scripts\local-deploy.ps1
  .\scripts\local-deploy.ps1 -Questions "D:\prive\questions.json" -Reset
  .\scripts\local-deploy.ps1 -NoStart

.PARAMETER Questions
  Chemin de la banque privée (défaut : C:\leboncivique-prive\questions.json, ou $env:LBC_QUESTIONS).
.PARAMETER Reset
  Supprime la base locale (.wrangler\) avant de la recréer.
.PARAMETER NoStart
  Prépare tout sans lancer le serveur.

  Si PowerShell refuse d'exécuter le script :
    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
  ou, pour cette seule exécution :
    powershell -ExecutionPolicy Bypass -File .\scripts\local-deploy.ps1
#>
[CmdletBinding()]
param(
  [string]$Questions = $(if ($env:LBC_QUESTIONS) { $env:LBC_QUESTIONS } else { 'C:\leboncivique-prive\questions.json' }),
  [switch]$Reset,
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$Repo = (Get-Location).Path

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "`nErreur : $text" -ForegroundColor Red; exit 1 }
# Lance une commande native et s'arrête si elle échoue (PowerShell 5.1 ne le fait pas seul).
function Run {
  $exe = $args[0]
  $rest = @($args | Select-Object -Skip 1)
  & $exe @rest
  if ($LASTEXITCODE -ne 0) { Fail "échec de : $($args -join ' ')" }
}

Step '1/6 Vérification des prérequis'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js est introuvable. Installez-le : winget install OpenJS.NodeJS.LTS' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { Fail 'npm est introuvable.' }
$nodeVersion = [version]((node -v).TrimStart('v'))
if ($nodeVersion -lt [version]'22.23.4') { Fail "Node.js $nodeVersion détecté : 22.23.4 minimum requis (winget upgrade OpenJS.NodeJS.LTS)." }
Write-Host "Node.js $nodeVersion, npm $(npm.cmd -v)"

Step '2/6 Installation des dépendances'
$lock = Join-Path $Repo 'package-lock.json'
$installed = Join-Path $Repo 'node_modules\.package-lock.json'
if (-not (Test-Path $installed) -or (Get-Item $lock).LastWriteTime -gt (Get-Item $installed).LastWriteTime) {
  Run npm.cmd ci
} else {
  Write-Host 'Dépendances déjà à jour.'
}

Step '3/6 Préparation de la banque de questions'
if (-not (Test-Path -LiteralPath $Questions -PathType Leaf)) {
  Fail "Banque introuvable : $Questions`nTéléchargez banque-questions/questions.json depuis les fichiers du projet, rangez-le hors du dépôt,`npuis relancez : .\scripts\local-deploy.ps1 -Questions 'C:\chemin\questions.json'"
}
$qFull = (Resolve-Path -LiteralPath $Questions).Path
if ($qFull.StartsWith($Repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  Fail 'La banque ne doit pas se trouver dans le dossier du dépôt (risque de la versionner).'
}
Run node scripts/build-seed.mjs $qFull

Step '4/6 Variables locales (.dev.vars)'
if (-not (Test-Path .dev.vars)) {
  $content = (Get-Content .dev.vars.example -Raw).TrimEnd() + "`nSESSIONS_PER_HOUR=100`n"
  [IO.File]::WriteAllText((Join-Path $Repo '.dev.vars'), $content, (New-Object Text.UTF8Encoding $false))
  Write-Host '.dev.vars créé.'
} else {
  Write-Host '.dev.vars existe déjà : conservé.'
}
if (Select-String -Path .dev.vars -Pattern '^TURNSTILE_SECRET=' -Quiet) {
  Write-Host 'Attention : TURNSTILE_SECRET est défini dans .dev.vars ; la vérification Turnstile sera réelle.' -ForegroundColor Yellow
}

Step '5/6 Base D1 locale'
if ($Reset -and (Test-Path .wrangler)) { Remove-Item -Recurse -Force .wrangler; Write-Host 'Base locale supprimée.' }
$env:CI = 'true'   # évite la question de confirmation de wrangler
Run npx.cmd wrangler d1 migrations apply leboncivique --local
Remove-Item Env:\CI
Run npx.cmd wrangler d1 execute leboncivique --local --file seed/questions.sql | Out-Null
Run npx.cmd wrangler d1 execute leboncivique --local --command "DELETE FROM rate_limits" | Out-Null
$json = npx.cmd wrangler d1 execute leboncivique --local --json --command "SELECT COUNT(*) AS n FROM questions"
if ($LASTEXITCODE -ne 0) { Fail 'impossible de lire la base locale.' }
$count = (($json -join "`n") | ConvertFrom-Json)[0].results[0].n
Write-Host "$count questions chargées."
if ($count -le 0) { Fail 'Aucune question dans la base locale.' }

if ($NoStart) {
  Step '6/6 Prêt. Lancez « npm run dev » puis ouvrez http://localhost:8787'
  exit 0
}
Step '6/6 Démarrage sur http://localhost:8787 (Ctrl+C pour arrêter)'
& npm.cmd run dev
