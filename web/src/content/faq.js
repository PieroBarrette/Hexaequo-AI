/**
 * What people ask before they play, answered from the code rather than from
 * memory: an account is needed only to be rated, and a rated game needs two
 * members and a clock (isRatedRoom in backend/services/ratedGameService.js);
 * quick match pairs by rating (matchmaking.js); ratings are Elo from 1000 with
 * K 40 for the first thirty games (eloService.js); the service worker keeps
 * the whole game, engine included, for offline play (web/sw.js). Change any
 * of those and the answer in the locale files changes with it.
 *
 * Each answer is HTML and goes into the FAQPage data word for word, because
 * structured data has to say what the page says.
 */

import { linkPages } from './shared.js';

/** The questions and answers, as the page shows them. */
export function faqItems(tr) {
  return (tr.raw('faq.items') || []).map(([question, answer]) => [question, linkPages(answer)]);
}

export function faqHtml(tr) {
  const { t } = tr;
  const out = [`<h1>${t('faq.heading')}</h1>`, `<p class="lede">${linkPages(t('faq.lede'))}</p>`];
  /* A question is a sentence to be read, not a section label: h3, in the
     case it was written in, rather than the small capitals of the h2s. */
  for (const [question, answer] of faqItems(tr)) {
    out.push(`<h3>${question}</h3>`, `<p>${answer}</p>`);
  }
  return out.join('\n      ');
}
