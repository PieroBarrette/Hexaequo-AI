/**
 * What the game is, for whoever wants more than the home screen says.
 *
 * The page a search for the game's name is most likely to land on, so it
 * names the spellings people reach for (cad75b4): a search engine can only
 * offer a correction for a word it has seen somewhere.
 */

import { pathOf } from '../pages.js';
import { further, linkPages, escapeText } from './shared.js';

export function aboutHtml(tr) {
  const { t, raw } = tr;
  const list = (path) => (raw(path) || []).map(([name, detail]) =>
    `<li><b>${escapeText(name)}</b> — ${escapeText(detail)}</li>`).join('\n          ');
  const rules = pathOf('rules', tr.language);
  return `
      <h1>Hexaequo</h1>
      <p class="lede">${t('about.intro')}</p>

      <h2>${t('about.waysTitle')}</h2>
      <ul>
          ${list('about.ways')}
      </ul>

      <h2>${t('about.whyTitle')}</h2>
      <ul>
          ${list('about.why')}
      </ul>

      <h2>${t('about.freeTitle')}</h2>
      <p>${t('about.freeText')}</p>

      <h2>${t('about.nameTitle')}</h2>
      <p>${t('about.nameText')}</p>

      ${further(tr)}
      <p>${linkPages(`<a href="${rules}">${t('about.rulesLink')}</a>`)}</p>`;
}
