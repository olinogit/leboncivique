// Sources officielles citées sur le site (vérifiées le 11 novembre 2026).
export const SRC = {
  loi: { label: 'Loi n° 2024-42 du 26 janvier 2024 pour contrôler l’immigration, améliorer l’intégration', url: 'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000049040245' },
  arrete: { label: 'Arrêté du 10 octobre 2025 relatif au programme, aux épreuves et aux modalités d’organisation de l’examen civique', url: 'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000052381620' },
  spActu: { label: 'Service-public.gouv.fr : examen civique obligatoire à partir du 1er janvier 2026', url: 'https://www.service-public.gouv.fr/particuliers/actualites/A18713' },
  spExamen: { label: 'Service-public.gouv.fr : examen civique (titre de séjour)', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F39530' },
  spLangue: { label: 'Service-public.gouv.fr : niveau de français exigé pour un titre de séjour', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F34501' },
  spNatLangue: { label: 'Service-public.gouv.fr : niveau de français pour la naturalisation', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F11926' },
  spNat: { label: 'Service-public.gouv.fr : naturalisation par décret', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2213' },
  interieur: { label: 'Ministère de l’Intérieur : communiqué sur l’examen civique', url: 'https://www.interieur.gouv.fr/actualites/communiques-de-presse/a-partir-du-1er-janvier-2026-reussite-a-lexamen-civique-sera-necessaire-pour-obtenir-carte-de-sejour' },
  formation: { label: 'Ministère de l’Intérieur : formation civique, fiches et questions officielles', url: 'https://formation-civique.interieur.gouv.fr/' },
  fei: { label: 'France Éducation international : informations pour les candidats', url: 'https://www.france-education-international.fr/examen-civique/examen-civique-informations-pour-les-candidats' },
} as const;
export type SourceKey = keyof typeof SRC;
