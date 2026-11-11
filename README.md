# Le bon civique

Site d'information et quiz d'entraînement à l'**examen civique** (obligatoire depuis le 1er janvier 2026 pour une première carte de séjour pluriannuelle, une carte de résident ou la naturalisation). Site indépendant et non officiel.

- Pages d'information en **français et en anglais** (Astro, HTML statique, très peu de JavaScript).
- Quiz **uniquement en français**, servi par une API Cloudflare Workers + D1.
- Gratuit, sans compte, sans publicité intrusive.

## Architecture

```
navigateur ──► Cloudflare (WAF, Bot Fight Mode, rate limiting)
                 ├─ pages statiques (dist/, en-têtes de public/_headers)
                 └─ /api/*  ──► Worker (worker/index.ts) ──► D1 (banque + parties)
```

**Pourquoi le quiz ne peut pas être téléchargé :**

| Mesure | Où |
| --- | --- |
| La banque de questions n'existe que dans D1 : jamais dans le dépôt, jamais dans `dist/` | `.gitignore`, CI |
| Une question à la fois, sans la bonne réponse ; impossible de sauter une question | `GET /api/question` |
| Correction côté serveur ; ordre des options mélangé à chaque partie (crypto) | `worker/quiz.ts` |
| Turnstile obligatoire pour créer une partie | `POST /api/session` |
| Limites par empreinte d'IP : 8 parties/h, 20 parties/jour, 90 requêtes/min | variables `wrangler.jsonc` |
| Réponse refusée si envoyée moins de 0,7 s après l'affichage | `POST /api/answer` |
| Séries limitées à 40 questions (plus d'option « toutes les questions ») | `FREE_SIZES` |
| Cookie `__Host-` HttpOnly, Secure, SameSite=Strict ; contrôle d'origine sur chaque POST | `worker/index.ts` |
| CGU : interdiction de l'extraction (droit du producteur de bases de données, CPI L341-1) | `/mentions-legales/` |

> Limite assumée : tout ce qui s'affiche peut être recopié. Ces mesures empêchent l'extraction **en masse** et la rendent lente et visible ; elles ne rendent pas la copie manuelle impossible. Les questions de connaissances sont par ailleurs publiées par le ministère de l'Intérieur : la vraie valeur protégée est dans les mises en situation et les explications.

## Structure

```
src/pages/            pages FR (racine) et EN (/en/)
src/scripts/quiz.ts   client du quiz (aucune bonne réponse côté client avant de répondre)
src/data/exemples.json  ~10 questions publiques par thème (page « Questions d'exemple », SEO)
worker/               API (index.ts), logique pure testée (quiz.ts, quiz.test.ts)
migrations/           schéma D1
scripts/build-seed.mjs  valide la banque et génère seed/questions.sql (non versionné)
public/_headers       CSP, HSTS, Permissions-Policy, etc.
```

## Développement local

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run seed -- /chemin/privé/questions.json      # génère seed/ et src/data/exemples.json
npx wrangler d1 migrations apply leboncivique --local
npx wrangler d1 execute leboncivique --local --file seed/questions.sql
npm run dev                                        # http://localhost:8787
npm test && npm run check
```

En local (`ENVIRONMENT=development`, sans `TURNSTILE_SECRET`), la vérification Turnstile est ignorée côté serveur. En production, l'absence de secret bloque la création de parties (échec fermé).

## Mise en production (à faire une fois)

1. **Dépôt GitHub** : passer le dépôt en privé, activer la protection de `main`, le secret scanning et Dependabot.
2. **Cloudflare** : ajouter la zone `leboncivique.fr`, puis :
   - SSL/TLS « Full (strict) », TLS 1.2 minimum, « Always Use HTTPS », HSTS (puis inscription sur hstspreload.org).
   - DNSSEC activé (et DS publié chez le registrar).
   - Bot Fight Mode activé.
   - Règle WAF de limitation de débit sur `/api/*` (par exemple 60 requêtes / 10 s par IP → blocage 10 min).
3. **D1** (données en Europe) :
   ```sh
   npx wrangler d1 create leboncivique --location weur   # copier l'id dans wrangler.jsonc
   npm run db:migrate:remote
   npx wrangler d1 execute leboncivique --remote --file seed/questions.sql
   ```
4. **Turnstile** : créer un widget « Managed » pour `leboncivique.fr`, puis :
   ```sh
   npx wrangler secret put TURNSTILE_SECRET
   npx wrangler secret put IP_HASH_KEY        # 32 octets aléatoires : openssl rand -hex 32
   PUBLIC_TURNSTILE_SITEKEY=<clé du site> npm run deploy
   ```
5. **DNS** : enregistrements CAA (`0 issue "letsencrypt.org"`, `0 issue "pki.goog"`, `0 issue "digicert.com"` selon les autorités utilisées par Cloudflare, `0 iodef "mailto:securite@leboncivique.fr"`), et, même sans envoi de courriel : `TXT "v=spf1 -all"`, `_dmarc TXT "v=DMARC1; p=reject;"`.
6. **Avant l'ouverture** : compléter les mentions légales (éditeur, directeur de publication), les adresses `contact@` et `securite@`, et le lien de dons ; lancer le workflow « DAST (OWASP ZAP baseline) » sur l'URL de production ; viser A+ sur Mozilla Observatory.

## Mettre à jour la banque de questions

La banque est gardée **hors du dépôt**. Modifier le fichier JSON privé, puis :

```sh
npm run seed -- /chemin/privé/questions.json
npx wrangler d1 execute leboncivique --remote --file seed/questions.sql
```

Format : `options[0]` est la bonne réponse (le serveur mélange l'ordre à chaque partie), `type: "situation"` pour une mise en situation, `procedures` parmi `cr`, `csp`, `nat`, et `theme` parmi les 5 thèmes de l'arrêté du 10 octobre 2025.
