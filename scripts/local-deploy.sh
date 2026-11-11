#!/usr/bin/env bash
# Déploiement local de Le bon civique (macOS / Linux).
#
#   ./scripts/local-deploy.sh [chemin/vers/questions.json] [--reset] [--no-start]
#
#   chemin     banque privée (défaut : ~/leboncivique-prive/questions.json, ou $LBC_QUESTIONS)
#   --reset    supprime la base locale (.wrangler/) avant de la recréer
#   --no-start prépare tout sans lancer le serveur
#
# Voir docs/local-deployment.md pour le détail de chaque étape.
set -euo pipefail

QUESTIONS="${LBC_QUESTIONS:-$HOME/leboncivique-prive/questions.json}"
RESET=0
START=1
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    --no-start) START=0 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    -*) echo "Option inconnue : $arg" >&2; exit 2 ;;
    *) QUESTIONS="$arg" ;;
  esac
done

cd "$(dirname "$0")/.."
step() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31mErreur : %s\033[0m\n' "$1" >&2; exit 1; }

step "1/6 Vérification des prérequis"
command -v node >/dev/null || fail "Node.js est introuvable. Installez Node.js 22.23.4 ou plus récent."
command -v npm >/dev/null || fail "npm est introuvable."
node -e '
  const [a,b,c] = process.versions.node.split(".").map(Number);
  const ok = a > 22 || (a === 22 && (b > 23 || (b === 23 && c >= 4)));
  if (!ok) { console.error("Node.js " + process.versions.node + " détecté : 22.23.4 minimum requis."); process.exit(1); }
' || fail "Version de Node.js trop ancienne."
echo "Node.js $(node -v), npm $(npm -v)"

step "2/6 Installation des dépendances"
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci
else
  echo "Dépendances déjà à jour."
fi

step "3/6 Préparation de la banque de questions"
[ -f "$QUESTIONS" ] || fail "Banque introuvable : $QUESTIONS
Téléchargez banque-questions/questions.json depuis les fichiers du projet,
rangez-le hors du dépôt, puis relancez : ./scripts/local-deploy.sh /chemin/vers/questions.json"
case "$(cd "$(dirname "$QUESTIONS")" && pwd)/" in
  "$(pwd)/"*) fail "La banque ne doit pas se trouver dans le dossier du dépôt (risque de la versionner)." ;;
esac
node scripts/build-seed.mjs "$QUESTIONS"

step "4/6 Variables locales (.dev.vars)"
if [ ! -f .dev.vars ]; then
  cp .dev.vars.example .dev.vars
  printf 'SESSIONS_PER_HOUR=100\n' >> .dev.vars
  echo ".dev.vars créé."
else
  echo ".dev.vars existe déjà : conservé."
fi
grep -q '^TURNSTILE_SECRET=' .dev.vars && echo "Attention : TURNSTILE_SECRET est défini dans .dev.vars ; la vérification Turnstile sera réelle."

step "5/6 Base D1 locale"
if [ "$RESET" -eq 1 ]; then rm -rf .wrangler; echo "Base locale supprimée."; fi
CI=true npx wrangler d1 migrations apply leboncivique --local
npx wrangler d1 execute leboncivique --local --file seed/questions.sql >/dev/null
npx wrangler d1 execute leboncivique --local --command "DELETE FROM rate_limits" >/dev/null
COUNT=$(npx wrangler d1 execute leboncivique --local --json --command "SELECT COUNT(*) AS n FROM questions" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].results[0].n))')
echo "$COUNT questions chargées."
[ "$COUNT" -gt 0 ] || fail "Aucune question dans la base locale."

if [ "$START" -eq 0 ]; then
  step "6/6 Prêt. Lancez « npm run dev » puis ouvrez http://localhost:8787"
  exit 0
fi
step "6/6 Démarrage sur http://localhost:8787 (Ctrl+C pour arrêter)"
exec npm run dev
