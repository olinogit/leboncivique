# Mise en production

Les scripts `scripts/deploy-production.sh` (macOS, Linux) et `scripts/deploy-production.ps1` (Windows) déploient le site sur Cloudflare : base D1, migrations, banque de questions, secrets, site, puis vérifications. Ils demandent confirmation avant chaque action en production.

> La banque de questions reste **hors du dépôt**. Les scripts refusent une banque rangée dans le dossier du dépôt.

## Prérequis

- Node.js 22.23.4 ou plus récent.
- Un compte Cloudflare où la zone `leboncivique.fr` est ajoutée (le script ouvre `wrangler login` si besoin).
- Un widget Turnstile « Managed » créé pour le domaine : sa clé publique (site key) et sa clé secrète.
- La banque privée `questions.json`, par défaut dans `~/leboncivique-prive/` (macOS, Linux) ou `C:\leboncivique-prive\` (Windows).

## Configuration (une fois)

```sh
cp scripts/deploy.config.example.env scripts/deploy.config.env
```

Renseigner `PUBLIC_TURNSTILE_SITEKEY` dans `scripts/deploy.config.env`. Ce fichier ne contient aucun secret et n'est pas versionné (`.gitignore`). Un autre emplacement peut être indiqué avec la variable `LBC_DEPLOY_CONFIG`.

## Premier déploiement et mises à jour du site

```sh
./scripts/deploy-production.sh /chemin/vers/questions.json          # macOS / Linux
.\scripts\deploy-production.ps1 -Questions C:\chemin\questions.json  # Windows
```

| Étape | Ce que fait le script |
| --- | --- |
| 1 | Vérifie Node.js, installe les dépendances, ouvre la connexion Cloudflare si besoin |
| 2 | Lance les tests et le contrôle des types |
| 3 | Valide la banque et génère `seed/questions.sql` (non versionné) |
| 4 | Crée la base D1 `leboncivique` en Europe si elle n'existe pas et écrit son identifiant dans `wrangler.jsonc` ; applique les migrations ; charge les questions |
| 5 | Crée `IP_HASH_KEY` (32 octets aléatoires) et demande `TURNSTILE_SECRET` s'ils sont absents |
| 6 | Vérifie que la clé publique Turnstile n'est pas une clé de test |
| 7 | Construit et déploie le site |
| 8 | Vérifie les pages principales et que `/data/questions.json` renvoie 404 |

Après le premier déploiement, committez `wrangler.jsonc` s'il a reçu l'identifiant de la base (il n'est pas secret).

Aux déploiements suivants, la base et les secrets existants sont détectés et conservés : seuls les nouvelles migrations, les questions et le site sont mis à jour.

## Mettre à jour uniquement les questions

```sh
./scripts/deploy-production.sh /chemin/vers/questions.json --seed-only
.\scripts\deploy-production.ps1 -Questions C:\chemin\questions.json -SeedOnly
```

Le remplacement est complet : les parties commencées depuis moins de 2 heures peuvent être interrompues. Préférez un créneau de nuit.

## Options

| Bash | PowerShell | Effet |
| --- | --- | --- |
| `--seed-only` | `-SeedOnly` | Met à jour seulement la banque en production |
| `--yes` | `-Yes` | Ne demande pas de confirmation (à réserver à un usage maîtrisé) |

## Réglages Cloudflare hors script

À faire une fois dans le tableau de bord : SSL « Full (strict) », TLS 1.2 minimum, HSTS, DNSSEC, Bot Fight Mode, règle de limitation de débit sur `/api/*`, enregistrements CAA, SPF et DMARC. Le détail est dans le README, section « Mise en production ».
