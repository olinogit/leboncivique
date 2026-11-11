# Le bon civique

Quiz d'entraînement à l'**examen civique** : questions de connaissances et **mises en situation**, pour la carte de résident (CR), la carte de séjour pluriannuelle (CSP) et la naturalisation.

> Outil de révision non officiel. Vérifiez toujours les informations sur les sources citées (formation-civique.interieur.gouv.fr).

## Fonctionnalités

- 443 questions à 4 choix, chacune avec une explication et un lien vers la fiche officielle.
- 3 démarches : CR et CSP (banque commune, 241 questions), naturalisation (293 questions).
- 4 thèmes : principes et valeurs de la République, droits et devoirs, histoire-géographie-culture, vivre dans la société française.
- 50 mises en situation, communes aux trois démarches.
- **Mode libre** (nombre de questions au choix) ou **mode examen** (40 questions dont 12 mises en situation).
- Correction immédiate ou à la fin, bilan par thème, revue filtrable, export PDF du résultat.
- Aucune donnée envoyée ni stockée : tout se passe dans le navigateur.

## Structure

```
index.html                 interface et logique du quiz
data/questions.json        banque de questions
vendor/jspdf.umd.min.js    jsPDF 4.2.1 (licence MIT) pour l'export PDF
scripts/validate_questions.py   contrôle de la banque de questions
.github/workflows/pages.yml     validation puis publication GitHub Pages
```

## Lancer en local

La page charge `data/questions.json` avec `fetch`, ce qui ne fonctionne pas en ouvrant le fichier directement (`file://`). Servez le dossier :

```sh
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Format d'une question

```json
{
  "id": 394,
  "theme": "Principes et valeurs de la République",
  "type": "situation",
  "question": "Dans une entreprise, un salarié refuse de travailler avec sa collègue au motif qu'elle est une femme. Quel principe de la République n'est pas respecté ?",
  "options": [
    "L'égalité entre les femmes et les hommes",
    "La liberté d'association",
    "Le droit de grève",
    "La séparation des pouvoirs"
  ],
  "explanation": "Les femmes et les hommes sont égaux en droits…",
  "source": "https://formation-civique.interieur.gouv.fr/fiches-par-thematiques/principes-et-valeurs-de-la-republique/",
  "procedures": ["cr", "csp", "nat"]
}
```

- La **bonne réponse est toujours la première** de `options` ; l'ordre est mélangé à l'affichage.
- `type` vaut `"situation"` pour une mise en situation, et est absent pour une question de connaissances.
- `procedures` : une ou plusieurs valeurs parmi `cr`, `csp`, `nat`.
- `theme` doit être l'un des 4 thèmes listés plus haut.

Après une modification, lancez `python3 scripts/validate_questions.py`.

## Publication

Le workflow publie le site sur GitHub Pages à chaque push sur `main`. À activer une fois dans *Settings → Pages → Source : GitHub Actions*.

## Licences

jsPDF est distribué sous licence MIT (voir l'en-tête de `vendor/jspdf.umd.min.js`).
