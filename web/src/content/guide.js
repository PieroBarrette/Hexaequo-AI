/**
 * What comes after the rules: the opening turns, the mistakes, the levels.
 *
 * Every fact in it is the engine's: the seven first moves and the five replies
 * that lose at once were counted with web/src/game/, the strongest level was
 * asked for its opinion of the seven, and the levels are LEVELS in ai.js. A
 * change to either should be checked against what the locale files say here.
 *
 * The text is HTML, links and all.
 */

import { linkPages } from './shared.js';

export function guideHtml(tr) {
  const { t, raw } = tr;
  const out = [`<h1>${t('guide.heading')}</h1>`, `<p class="lede">${linkPages(t('guide.lede'))}</p>`];
  for (const section of raw('guide.sections') || []) {
    out.push(`<h2>${section.title}</h2>`);
    if (section.intro) out.push(`<p>${linkPages(section.intro)}</p>`);
    /* A tip leads with a sentence, as the rules' fine print does; a level
       leads with its name, as the lists on the page about the game do. */
    if (section.tips) {
      out.push('<ul>', ...section.tips.map(([lead, rest]) => `<li><b>${lead}</b> ${linkPages(rest)}</li>`), '</ul>');
    }
    if (section.levels) {
      out.push('<ul>', ...section.levels.map(([name, rest]) => `<li><b>${name}</b> — ${rest}</li>`), '</ul>');
    }
    if (section.outro) out.push(`<p>${linkPages(section.outro)}</p>`);
  }
  return out.join('\n      ');
}
