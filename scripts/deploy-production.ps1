# Mise en production de Le bon civique sur Cloudflare (Windows PowerShell 5.1 ou PowerShell 7).
#
#   .\scripts\deploy-production.ps1 [-Questions C:\chemin\questions.json] [-SeedOnly] [-Yes]
#
#   -Questions banque privée (défaut : C:\leboncivique-prive\questions.json, ou $env:LBC_QUESTIONS)
#   -SeedOnly  met seulement à jour la banque de questions en production
#   -Yes       ne demande pas de confirmation avant les étapes distantes
#
# Paramètres lus dans scripts\deploy.config.env (copier deploy.config.example.env),
# ou dans le fichier indiqué par $env:LBC_DEPLOY_CONFIG.
# Voir docs\production-deployment.md pour le détail.
#
# Si PowerShell refuse le script : Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
param(
  [string]$Questions = $(if ($env:LBC_QUESTIONS) { $env:LBC_QUESTIONS } else { 'C:\leboncivique-prive\questions.json' }),
  [switch]$SeedOnly,
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'

$App = Split-Path -Parent $PSScriptRoot
$Bank = $Questions

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "`nErreur : $m" -ForegroundColor Red; exit 1 }
function Run { & $args[0] @($args | Select-Object -Skip 1); if ($LASTEXITCODE -ne 0) { Fail "échec de : $($args -join ' ')" } }
function Confirm-Step($m) {
  if ($Yes) { return }
  $r = Read-Host "$m [o/N]"
  if ($r -notmatch '^(o|oui|y|yes)$') { Write-Host 'Annulé.'; exit 1 }
}

$cfgPath = if ($env:LBC_DEPLOY_CONFIG) { $env:LBC_DEPLOY_CONFIG } else { Join-Path $PSScriptRoot 'deploy.config.env' }
if (-not (Test-Path $cfgPath)) { Fail "$cfgPath introuvable. Copiez scripts\deploy.config.example.env en scripts\deploy.config.env et complétez-le." }
$cfg = @{}
Get-Content $cfgPath | Where-Object { $_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$' } | ForEach-Object {
  $null = $_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$'; $cfg[$Matches[1]] = $Matches[2].Trim().Trim('"')
}
$Domain = $cfg['DOMAIN']; if (-not $Domain) { Fail 'DOMAIN manquant dans config.env' }
$Location = if ($cfg['D1_LOCATION']) { $cfg['D1_LOCATION'] } else { 'weur' }

Set-Location $App

Step '1/8 Prérequis'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js est introuvable (22.23.4 minimum).' }
node -e "const [a,b,c]=process.versions.node.split('.').map(Number);if(!(a>22||(a===22&&(b>23||(b===23&&c>=4)))))process.exit(1)"
if ($LASTEXITCODE -ne 0) { Fail "Node.js $(node -v) trop ancien : 22.23.4 minimum." }
if (-not (Test-Path -LiteralPath $Bank -PathType Leaf)) { Fail "Banque introuvable : $Bank" }
$bankFull = (Resolve-Path -LiteralPath $Bank).Path
if ($bankFull.StartsWith($App + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { Fail 'La banque ne doit pas se trouver dans le dossier du dépôt (risque de la versionner).' }
$Bank = $bankFull
if (-not (Test-Path 'node_modules') -or ((Get-Item 'package-lock.json').LastWriteTime -gt (Get-Item 'node_modules').LastWriteTime)) { Run npm ci }
npx wrangler whoami *> $null
if ($LASTEXITCODE -ne 0) { Write-Host 'Connexion à Cloudflare...'; Run npx wrangler login }

Step '2/8 Contrôles (tests, types)'
if (-not $SeedOnly) { Run npm test; Run npm run check } else { Write-Host 'Ignoré (-SeedOnly).' }

Step '3/8 Génération de la banque (seed\questions.sql)'
Run node scripts/build-seed.mjs $Bank

Step '4/8 Base D1 en production'
$wr = Get-Content 'wrangler.jsonc' -Raw
$dbid = if ($wr -match '"database_id"\s*:\s*"([^"]+)"') { $Matches[1] } else { '' }
if (-not $dbid -or $dbid -eq '00000000-0000-0000-0000-000000000000') {
  $list = (npx wrangler d1 list --json 2>$null) -join "`n"
  $exist = try { (($list | ConvertFrom-Json) | Where-Object { $_.name -eq 'leboncivique' }).uuid } catch { $null }
  if (-not $exist) {
    Confirm-Step "Créer la base D1 « leboncivique » (région $Location) ?"
    Run npx wrangler d1 create leboncivique --location $Location
    $exist = (((npx wrangler d1 list --json) -join "`n" | ConvertFrom-Json) | Where-Object { $_.name -eq 'leboncivique' }).uuid
  }
  if (-not $exist) { Fail "Impossible de retrouver l'identifiant de la base D1." }
  $wr = $wr -replace '("database_id"\s*:\s*")[^"]+(")', "`${1}$exist`${2}"
  [IO.File]::WriteAllText((Join-Path $App 'wrangler.jsonc'), $wr)
  Write-Host "wrangler.jsonc mis à jour avec l'identifiant $exist (à committer)."
} else { Write-Host "Base existante : $dbid" }
Confirm-Step 'Appliquer les migrations et remplacer les questions en PRODUCTION ?'
$env:CI = 'true'; Run npx wrangler d1 migrations apply leboncivique --remote; Remove-Item Env:CI
Run npx wrangler d1 execute leboncivique --remote --file seed/questions.sql
$count = (((npx wrangler d1 execute leboncivique --remote --json --command 'SELECT COUNT(*) AS n FROM questions') -join "`n" | ConvertFrom-Json)[0].results[0].n)
Write-Host "$count questions en production."
if (-not ($count -gt 0)) { Fail 'Aucune question en production.' }

if ($SeedOnly) { Step 'Banque mise à jour. Fin (-SeedOnly).'; exit 0 }

Step '5/8 Secrets du Worker'
$secrets = (npx wrangler secret list 2>$null) -join "`n"
if ($secrets -notmatch '"IP_HASH_KEY"') {
  Write-Host "IP_HASH_KEY absent : génération d'une clé aléatoire de 32 octets."
  node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | npx wrangler secret put IP_HASH_KEY
  if ($LASTEXITCODE -ne 0) { Fail 'IP_HASH_KEY non enregistré.' }
} else { Write-Host 'IP_HASH_KEY déjà défini.' }
if ($secrets -notmatch '"TURNSTILE_SECRET"') {
  Write-Host "TURNSTILE_SECRET absent : collez la clé secrète du widget Turnstile."
  Run npx wrangler secret put TURNSTILE_SECRET
} else { Write-Host 'TURNSTILE_SECRET déjà défini.' }

Step '6/8 Clé publique Turnstile'
$siteKey = $cfg['PUBLIC_TURNSTILE_SITEKEY']
if (-not $siteKey) { Fail 'PUBLIC_TURNSTILE_SITEKEY manquant dans config.env' }
if ($siteKey -match '^[123]x0000') { Fail "PUBLIC_TURNSTILE_SITEKEY est une clé de test : utilisez celle du widget de $Domain." }
$env:PUBLIC_TURNSTILE_SITEKEY = $siteKey

Step '7/8 Construction et déploiement'
Confirm-Step "Déployer le site sur $Domain ?"
Run npm run deploy

Step '8/8 Vérification'
Start-Sleep -Seconds 5
foreach ($p in '/', '/quiz/', '/en/', '/robots.txt', '/.well-known/security.txt', '/data/questions.json') {
  try { $c = (Invoke-WebRequest -Uri "https://$Domain$p" -Method Head -UseBasicParsing -ErrorAction Stop).StatusCode }
  catch { $c = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 } }
  $note = if ($p -eq '/data/questions.json') { ' (404 attendu : la banque ne doit pas être publique)' } else { '' }
  Write-Host ('{0,-28} {1}{2}' -f $p, $c, $note)
}
Write-Host "`nDéploiement terminé : https://$Domain" -ForegroundColor Green
Write-Host "Si wrangler.jsonc a reçu un nouvel identifiant D1, committez-le (il n'est pas secret)."
