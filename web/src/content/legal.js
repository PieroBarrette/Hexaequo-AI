/**
 * Privacy policy and terms of service.
 *
 * Their text lives in the locale files like everything else, so both
 * languages stay in step. Sections are keyed p1, p2… and t1, t2…; the pages
 * take as many as the locale has, so a section added there needs no change
 * here.
 */

import { logoMarkSvg } from '../ui/logo.js';

/**
 * The address published in both policies, in one place so it can be changed
 * without touching either translation.
 *
 * On the domain rather than a personal mailbox: it reads better on a legal
 * page, it survives a change of provider, and it can be forwarded wherever
 * the mail is actually read without anything here changing.
 */
export const CONTACT_EMAIL = 'info@hexaequo.com';

export function legalHtml(tr, which) {
  const { t, raw } = tr;
  const letter = which === 'privacy' ? 'p' : 't';
  const sections = [];
  for (let i = 1; raw(`legal.${letter}${i}Title`) !== undefined; i++) {
    sections.push(`<h2>${t(`legal.${letter}${i}Title`)}</h2><p>${t(`legal.${letter}${i}Body`)}</p>`);
  }
  return `
      <div class="legal">
        <h1>${t(`legal.${which}Title`)}</h1>
        <p class="legal-date">${t('legal.updated')}</p>
        <p class="lede">${t(`legal.${which}Intro`)}</p>
        ${sections.join('\n        ')}
        <h2>${t('legal.contactHeading')}</h2>
        <p>${t('legal.contactBody', { email: CONTACT_EMAIL })}</p>
        <div class="legal-foot"><div class="legal-mark">${logoMarkSvg({ decorative: true })}</div></div>
      </div>`;
}
