/**
 * The pages that have an address, by name: what the panel is titled, what the
 * browser tab and a search result call it, and what it says.
 *
 * Read by the app's panels and by backend/scripts/makePages.js, so the page a
 * search engine indexes and the panel a player opens are the same words.
 */

import { rulesHtml } from './rules.js';
import { aboutHtml } from './about.js';
import { guideHtml } from './guide.js';
import { faqHtml } from './faq.js';
import { legalHtml } from './legal.js';

const titled = (key) => (tr) => `${tr.t(key)} — Hexaequo`;

export const CONTENT = {
  rules: {
    title: (tr) => tr.t('rules.title'),
    docTitle: titled('rules.title'),
    description: (tr) => tr.t('rules.lede'),
    html: rulesHtml,
  },
  about: {
    title: (tr) => tr.t('about.title'),
    docTitle: (tr) => tr.t('about.docTitle'),
    description: (tr) => tr.t('about.description'),
    html: aboutHtml,
  },
  guide: {
    title: (tr) => tr.t('guide.title'),
    docTitle: (tr) => tr.t('guide.docTitle'),
    description: (tr) => tr.t('guide.description'),
    html: guideHtml,
  },
  faq: {
    title: (tr) => tr.t('faq.title'),
    docTitle: (tr) => tr.t('faq.docTitle'),
    description: (tr) => tr.t('faq.description'),
    html: faqHtml,
  },
  privacy: {
    title: (tr) => tr.t('nav.privacy'),
    docTitle: titled('nav.privacy'),
    description: (tr) => tr.t('legal.privacyIntro'),
    html: (tr) => legalHtml(tr, 'privacy'),
  },
  terms: {
    title: (tr) => tr.t('nav.terms'),
    docTitle: titled('nav.terms'),
    description: (tr) => tr.t('legal.termsIntro'),
    html: (tr) => legalHtml(tr, 'terms'),
  },
};
