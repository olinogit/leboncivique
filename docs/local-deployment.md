# Déploiement local de Le bon civique

Cette procédure fait tourner le site (pages statiques Astro et API du quiz sur Workers et D1) sur un poste de développement. Tout reste local : rien n'est envoyé chez Cloudflare, et aucun compte Cloudflare n'est nécessaire.

Les commandes sont données pour **PowerShell (Windows)** et pour **macOS ou Linux** quand elles diffèrent.

---

## Méthode rapide : script automatique

Une fois les prérequis installés (section 1) et la banque rangée hors du dépôt (section 3), un script enchaîne les étapes 2 à 6. Il vérifie la version de Node, installe les dépendances, génère le SQL, crée `.dev.vars`, crée la base D1 locale et charge les questions, puis lance le site.

```powershell
# Windows (PowerShell), depuis le dossier du dépôt
.\scripts\local-deploy.ps1                                   # banque dans C:\leboncivique-prive\questions.json
.\scripts\local-deploy.ps1 -Questions "D:\prive\questions.json"
.\scripts\local-deploy.ps1 -Reset                            # repart d'une base locale vide
.\scripts\local-deploy.ps1 -NoStart                          # prépare sans lancer le serveur
```

Si PowerShell refuse d'exécuter le script : `powershell -ExecutionPolicy Bypass -File .\scripts\local-deploy.ps1`.

```sh
# macOS / Linux
./scripts/local-deploy.sh                                     # banque dans ~/leboncivique-prive/questions.json
./scripts/local-deploy.sh /chemin/vers/questions.json --reset
./scripts/local-deploy.sh --no-start
```

Le script s'arrête avec un message clair si Node est trop ancien, si la banque est introuvable ou si elle se trouve dans le dossier du dépôt. Il conserve un `.dev.vars` existant. Les sections suivantes détaillent ce qu'il fait, pour le faire à la main.

---

## 1. Prérequis

| Outil | Version | Installation |
| --- | --- | --- |
| Node.js | **22.23.4 ou plus** (exigé par Astro 7) | Windows : `winget install OpenJS.NodeJS.LTS` · macOS : `brew install node` |
| Git | récente | Windows : `winget install Git.Git` |

Vérifier :

```
node -v
npm -v
git --version
```

**Windows uniquement :** si PowerShell bloque `npm` (« l'exécution de scripts est désactivée sur ce système »), lancer :

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Si le dépôt GitHub est privé, Git Credential Manager demande de se connecter à GitHub au premier clone.

---

## 2. Récupérer le code

```
git clone https://github.com/olinogit/leboncivique.git
cd leboncivique
git checkout claude/project-thread-egwtph
npm ci
```

> Une fois la PR fusionnée, rester sur `main` à la place de `git checkout claude/project-thread-egwtph`.

---

## 3. Préparer la banque de questions (hors du dépôt)

La banque de questions n'est **jamais** versionnée. Récupérer `questions.json` depuis les fichiers du projet (`banque-questions/questions.json`) et le ranger **en dehors** du dossier du dépôt :

- Windows : `C:\leboncivique-prive\questions.json`
- macOS ou Linux : `~/leboncivique-prive/questions.json`

Générer ensuite le fichier SQL de chargement :

```powershell
# Windows
node scripts/build-seed.mjs "C:\leboncivique-prive\questions.json"
```

```sh
# macOS / Linux
node scripts/build-seed.mjs ~/leboncivique-prive/questions.json
```

Résultat attendu : `OK : 443 questions → seed/questions.sql ; 50 exemples → src/data/exemples.json`

- `seed/questions.sql` est ignoré par git.
- `src/data/exemples.json` contient les questions d'exemple publiques (10 par thème).
- Si la banque contient une erreur (thème inconnu, option en double, source non https…), le script s'arrête et indique la question en cause.

---

## 4. Variables locales

```powershell
# Windows
Copy-Item .dev.vars.example .dev.vars
```

```sh
# macOS / Linux
cp .dev.vars.example .dev.vars
```

Ajouter à la fin de `.dev.vars`, pour ne pas être bloqué par la limite de 8 parties par heure pendant les tests :

```
SESSIONS_PER_HOUR=100
```

Contenu final de `.dev.vars` :

```
ENVIRONMENT=development
IP_HASH_KEY=dev-only-key-not-secret
SESSIONS_PER_HOUR=100
```

À propos de Turnstile en local :

- **Ne pas** définir `TURNSTILE_SECRET` en local. Le serveur ignore la vérification Turnstile uniquement parce que `ENVIRONMENT=development`. En production, l'absence de secret bloque la création de parties.
- La page du quiz utilise la clé de site de test Cloudflare `1x00000000000000000000AA`, qui valide toujours, sur `localhost` aussi.
- `.dev.vars` est ignoré par git : n'y mettez jamais de vrai secret de production.

---

## 5. Créer la base D1 locale et charger les questions

```
npx wrangler d1 migrations apply leboncivique --local
npx wrangler d1 execute leboncivique --local --file seed/questions.sql
```

Répondre `y` si la première commande demande confirmation. La base SQLite locale est créée dans `.wrangler/`, qui est ignoré par git.

Vérifier le chargement :

```
npx wrangler d1 execute leboncivique --local --command "SELECT theme, kind, COUNT(*) AS n FROM questions GROUP BY theme, kind"
```

---

## 6. Lancer le site

```
npm run dev
```

Cette commande construit le site (`astro build`, dans `dist/`), puis démarre `wrangler dev`. Ouvrir ensuite **http://localhost:8787**.

- Utiliser `localhost` et non `127.0.0.1` : le cookie de partie est `Secure` et préfixé `__Host-`.
- `wrangler dev` ne détecte pas une reconstruction faite pendant qu'il tourne. Après une modification, arrêter avec `Ctrl+C`, puis relancer `npm run dev`.

---

## 7. Vérifications

### Parcours fonctionnel

1. `http://localhost:8787/` : accueil en français.
2. `http://localhost:8787/en/` : pages en anglais.
3. `http://localhost:8787/questions-exemples/` : 5 thèmes, 10 questions chacun.
4. `http://localhost:8787/quiz/` : lancer une série de 10 questions, répondre, voir la correction, le bilan, puis télécharger le PDF.
5. Lancer un examen blanc : 40 questions et chronomètre de 45 minutes.

### Tests et types

```
npm test
npm run check
```

Attendu : `# pass 7` et `0 errors`.

### En-têtes de sécurité

```powershell
# Windows
(Invoke-WebRequest http://localhost:8787/quiz/ -Method Head).Headers['Content-Security-Policy']
(Invoke-WebRequest http://localhost:8787/ -Method Head).Headers
```

```sh
# macOS / Linux
curl -sI http://localhost:8787/quiz/
curl -sI http://localhost:8787/
```

Attendu : `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `X-Frame-Options`.

### La banque n'est pas exposée

`http://localhost:8787/data/questions.json` doit répondre **404**.

### Protections de l'API (facultatif)

```powershell
# Windows : une requête d'une autre origine doit être refusée (403)
try {
  Invoke-WebRequest http://localhost:8787/api/session -Method Post -ContentType 'application/json' `
    -Headers @{ Origin = 'https://evil.example' } -Body '{}'
} catch { $_.Exception.Response.StatusCode.value__ }
```

```sh
# macOS / Linux
curl -s -X POST http://localhost:8787/api/session -H 'Content-Type: application/json' \
  -H 'Origin: https://evil.example' -d '{}'
```

Attendu : `403` (`{"error":"origin",...}`).

---

## 8. Dépannage

| Symptôme | Solution |
| --- | --- |
| `npm` bloqué dans PowerShell | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `Unsupported engine` ou erreur au `npm ci` | Mettre Node.js à jour (22.23.4 minimum) |
| « Trop de demandes » (429) dans le quiz | `npx wrangler d1 execute leboncivique --local --command "DELETE FROM rate_limits"` |
| « Réponse trop rapide » | Normal : une réponse envoyée moins de 0,7 s après l'affichage est refusée |
| « Banque de questions indisponible » | L'étape 5 n'a pas été faite, ou `seed/questions.sql` est vide : refaire les étapes 3 et 5 |
| « La vérification anti-robot n'est pas encore terminée » | Attendre quelques secondes, vérifier l'accès à `challenges.cloudflare.com` (proxy d'entreprise) |
| Page blanche ou 404 après une modification | Arrêter `wrangler dev` (`Ctrl+C`) puis relancer `npm run dev` |
| Repartir de zéro | Supprimer le dossier `.wrangler/`, puis refaire l'étape 5 |

---

## 9. Mettre à jour la banque de questions

1. Modifier le fichier privé `questions.json` : `options[0]` est la bonne réponse, et le serveur mélange l'ordre à chaque partie.
2. Régénérer : `node scripts/build-seed.mjs "<chemin>\questions.json"`.
3. Recharger : `npx wrangler d1 execute leboncivique --local --file seed/questions.sql`.
4. Relancer `npm run dev`.

Pour la mise en production (D1 distante, secrets, Turnstile, WAF, DNS), voir la section « Mise en production » du `README.md`.
