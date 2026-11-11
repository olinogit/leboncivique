#!/usr/bin/env python3
"""Vérifie la structure de data/questions.json avant publication."""
import json
import sys

THEMES = {
    "Principes et valeurs de la République",
    "Droits et devoirs",
    "Histoire, géographie et culture",
    "Vivre dans la société française",
}
PROCEDURES = {"cr", "csp", "nat"}
REQUIRED = {"id", "theme", "question", "options", "explanation", "source", "procedures"}


def main(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    errors = []
    seen = set()
    for i, q in enumerate(data):
        ref = f"#{q.get('id', '?')} (index {i})"
        missing = REQUIRED - q.keys()
        if missing:
            errors.append(f"{ref} : champs manquants {sorted(missing)}")
            continue
        if q["id"] in seen:
            errors.append(f"{ref} : id en double")
        seen.add(q["id"])
        if q["theme"] not in THEMES:
            errors.append(f"{ref} : thème inconnu « {q['theme']} »")
        opts = q["options"]
        if len(opts) != 4 or len(set(opts)) != 4 or not all(isinstance(o, str) and o.strip() for o in opts):
            errors.append(f"{ref} : il faut 4 options distinctes et non vides")
        if not q["procedures"] or not set(q["procedures"]) <= PROCEDURES:
            errors.append(f"{ref} : procédures invalides {q['procedures']}")
        if not str(q["source"]).startswith("https://"):
            errors.append(f"{ref} : source non HTTPS")
        if q.get("type") not in (None, "situation"):
            errors.append(f"{ref} : type inconnu « {q['type']} »")
    situations = sum(1 for q in data if q.get("type") == "situation")
    for p in sorted(PROCEDURES):
        bank = [q for q in data if p in q.get("procedures", [])]
        sit = sum(1 for q in bank if q.get("type") == "situation")
        if sit < 12 or len(bank) - sit < 28:
            errors.append(f"banque « {p} » trop petite pour le mode examen (40 questions dont 12 mises en situation)")
    if errors:
        print("\n".join(errors))
        sys.exit(1)
    print(f"OK : {len(data)} questions, dont {situations} mises en situation.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data/questions.json")
