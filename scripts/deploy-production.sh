#!/usr/bin/env bash
# Mise en production de Le bon civique sur Cloudflare (macOS / Linux).
#
#   ./scripts/deploy-production.sh [chemin/vers/questions.json] [--seed-only] [--yes]
#
#   chemin       banque privée (défaut : ~/leboncivique-prive/questions.json, ou $LBC_QUESTIONS)
#   --seed-only  met seulement à jour la banque de questions en production
#   --yes        ne demande pas de confirmation avant les étapes distantes
#
# Paramètres lus dans scripts/deploy.config.env (copier deploy.config.example.env),
# ou dans le fichier indiqué par $LBC_DEPLOY_CONFIG.
# Voir docs/production-deployment.md pour le détail.
set -euo pipefail

APP="$(cd "$(dirname "$0")/.." && pwd)"
BANK="${LBC_QUESTIONS:-$HOME/leboncivique-prive/questions.json}"
CONFIG="${LBC_DEPLOY_CONFIG:-$APP/scripts/deploy.config.env}"
SEED_ONLY=0
YES=0
for arg in "$@"; do
  case "$arg" in
    --seed-only) SEED_ONLY=1 ;;
    --yes) YES=1 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    -*) echo "Option inconnue : $arg" >&2; exit 2 ;;
    *) BANK="$arg" ;;
  esac
done

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31mErreur : %s\033[0m\n' "$1" >&2; exit 1; }
confirm() {
  [ "$YES" -eq 1 ] && return 0
  read -r -p "$1 [o/N] " r
  case "$r" in o|O|oui|OUI|y|Y) return 0 ;; *) echo "Annulé."; exit 1 ;; esac
}

[ -f "$CONFIG" ] || fail "$CONFIG introuvable. Copiez scripts/deploy.config.example.env en scripts/deploy.config.env et complétez-le."
# shellcheck disable=SC1090
set -a; . "$CONFIG"; set +a
: "${DOMAIN:?DOMAIN manquant dans config.env}"
: "${D1_LOCATION:=weur}"

cd "$APP"

step "1/8 Prérequis"
command -v node >/dev/null || fail "Node.js est introuvable (22.23.4 minimum)."
node -e '
  const [a,b,c] = process.versions.node.split(".").map(Number);
  if (!(a > 22 || (a === 22 && (b > 23 || (b === 23 && c >= 4))))) process.exit(1);
' || fail "Node.js $(node -v) trop ancien : 22.23.4 minimum."
[ -f "$BANK" ] || fail "Banque introuvable : $BANK"
case "$(cd "$(dirname "$BANK")" && pwd)/" in
  "$APP/"*) fail "La banque ne doit pas se trouver dans le dossier du dépôt (risque de la versionner)." ;;
esac
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then npm ci; fi
npx wrangler whoami >/dev/null 2>&1 || { echo "Connexion à Cloudflare..."; npx wrangler login; }
npx wrangler whoami | grep -iE "account|compte|email" | head -3 || true

step "2/8 Contrôles (tests, types)"
if [ "$SEED_ONLY" -eq 0 ]; then
  npm test
  npm run check
else
  echo "Ignoré (--seed-only)."
fi

step "3/8 Génération de la banque (seed/questions.sql)"
node scripts/build-seed.mjs "$BANK"

step "4/8 Base D1 en production"
DBID=$(node -e 'const s=require("fs").readFileSync("wrangler.jsonc","utf8");const m=s.match(/"database_id"\s*:\s*"([^"]+)"/);console.log(m?m[1]:"")')
if [ "$DBID" = "00000000-0000-0000-0000-000000000000" ] || [ -z "$DBID" ]; then
  EXIST=$(npx wrangler d1 list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const l=JSON.parse(s);const d=l.find(x=>x.name==="leboncivique");console.log(d?d.uuid:"")}catch{console.log("")}})')
  if [ -z "$EXIST" ]; then
    confirm "Créer la base D1 « leboncivique » (région $D1_LOCATION) ?"
    npx wrangler d1 create leboncivique --location "$D1_LOCATION"
    EXIST=$(npx wrangler d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).find(x=>x.name==="leboncivique");console.log(d?d.uuid:"")})')
  fi
  [ -n "$EXIST" ] || fail "Impossible de retrouver l'identifiant de la base D1."
  node -e '
    const fs=require("fs");const f="wrangler.jsonc";
    fs.writeFileSync(f, fs.readFileSync(f,"utf8").replace(/("database_id"\s*:\s*")[^"]+(")/, "$1"+process.argv[1]+"$2"));
  ' "$EXIST"
  echo "wrangler.jsonc mis à jour avec l'identifiant $EXIST (à committer)."
else
  echo "Base existante : $DBID"
fi
confirm "Appliquer les migrations et remplacer les questions en PRODUCTION ?"
CI=true npx wrangler d1 migrations apply leboncivique --remote
npx wrangler d1 execute leboncivique --remote --file seed/questions.sql >/dev/null
COUNT=$(npx wrangler d1 execute leboncivique --remote --json --command "SELECT COUNT(*) AS n FROM questions" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].results[0].n))')
echo "$COUNT questions en production."
[ "$COUNT" -gt 0 ] || fail "Aucune question en production."

if [ "$SEED_ONLY" -eq 1 ]; then
  step "Banque mise à jour. Fin (--seed-only)."
  exit 0
fi

step "5/8 Secrets du Worker"
SECRETS=$(npx wrangler secret list 2>/dev/null || echo "[]")
if ! echo "$SECRETS" | grep -q '"IP_HASH_KEY"'; then
  echo "IP_HASH_KEY absent : génération d'une clé aléatoire de 32 octets."
  node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))' | npx wrangler secret put IP_HASH_KEY
else
  echo "IP_HASH_KEY déjà défini."
fi
if ! echo "$SECRETS" | grep -q '"TURNSTILE_SECRET"'; then
  echo "TURNSTILE_SECRET absent : collez la clé secrète du widget Turnstile (elle ne s'affiche pas)."
  npx wrangler secret put TURNSTILE_SECRET
else
  echo "TURNSTILE_SECRET déjà défini."
fi

step "6/8 Clé publique Turnstile"
: "${PUBLIC_TURNSTILE_SITEKEY:?PUBLIC_TURNSTILE_SITEKEY manquant dans config.env}"
case "$PUBLIC_TURNSTILE_SITEKEY" in 1x0000*|2x0000*|3x0000*) fail "PUBLIC_TURNSTILE_SITEKEY est une clé de test : utilisez celle du widget de $DOMAIN." ;; esac
export PUBLIC_TURNSTILE_SITEKEY

step "7/8 Construction et déploiement"
confirm "Déployer le site sur $DOMAIN ?"
npm run deploy

step "8/8 Vérification"
sleep 5
for path in / /quiz/ /en/ /robots.txt /.well-known/security.txt; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN$path" || echo 000)
  printf '%-28s %s\n' "$path" "$code"
done
code=$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/data/questions.json" || echo 000)
printf '%-28s %s (404 attendu : la banque ne doit pas être publique)\n' "/data/questions.json" "$code"
curl -sI "https://$DOMAIN/" | grep -iE '^(content-security-policy|strict-transport-security):' | cut -c1-90 || true

printf '\n\033[1;32mDéploiement terminé : https://%s\033[0m\n' "$DOMAIN"
echo "Si wrangler.jsonc a reçu un nouvel identifiant D1, committez-le (il n'est pas secret)."
