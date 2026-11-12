// Correspondance des pages FR ↔ EN (hreflang, sélecteur de langue, navigation).
export type Lang = 'fr' | 'en';
export type PageKey =
  | 'home' | 'exam' | 'who' | 'since' | 'prepare' | 'quiz' | 'samples' | 'faq'
  | 'support' | 'partners' | 'legal' | 'privacy' | 'a11y';

export const ROUTES: Record<PageKey, { fr: string; en: string | null }> = {
  home: { fr: '/', en: '/en/' },
  exam: { fr: '/examen-civique/', en: '/en/civic-exam/' },
  who: { fr: '/qui-est-concerne/', en: '/en/who-must-take-it/' },
  since: { fr: '/depuis-quand/', en: '/en/since-when/' },
  prepare: { fr: '/se-preparer/', en: '/en/how-to-prepare/' },
  quiz: { fr: '/quiz/', en: '/en/practice-quiz/' },
  samples: { fr: '/questions-exemples/', en: null },
  faq: { fr: '/faq/', en: '/en/faq/' },
  support: { fr: '/soutenir/', en: '/en/support/' },
  partners: { fr: '/partenaires/', en: '/en/partners/' },
  legal: { fr: '/mentions-legales/', en: '/en/legal-notice/' },
  privacy: { fr: '/confidentialite/', en: '/en/privacy/' },
  a11y: { fr: '/accessibilite/', en: '/en/accessibility/' },
};

export const NAV: PageKey[] = ['exam', 'who', 'since', 'prepare', 'faq'];
export const FOOTER: PageKey[] = ['support', 'partners', 'legal', 'privacy', 'a11y'];

export const LABELS: Record<PageKey, { fr: string; en: string }> = {
  home: { fr: 'Accueil', en: 'Home' },
  exam: { fr: "L'examen civique", en: 'The civic exam' },
  who: { fr: 'Qui est concerné ?', en: 'Who must take it?' },
  since: { fr: 'Depuis quand ?', en: 'Since when?' },
  prepare: { fr: 'Se préparer', en: 'How to prepare' },
  quiz: { fr: "S'entraîner", en: 'Practice quiz' },
  samples: { fr: "Questions d'exemple", en: 'Sample questions' },
  faq: { fr: 'FAQ', en: 'FAQ' },
  support: { fr: 'Soutenir le site', en: 'Support the site' },
  partners: { fr: 'Formateurs et associations', en: 'Trainers and charities' },
  legal: { fr: 'Mentions légales', en: 'Legal notice' },
  privacy: { fr: 'Confidentialité', en: 'Privacy' },
  a11y: { fr: 'Accessibilité', en: 'Accessibility' },
};

export const UPDATED = '2026-11-11';
