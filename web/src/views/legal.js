/**
 * Privacy policy and terms of service.
 *
 * Google's OAuth consent screen requires a reachable URL for each, so these are
 * real routes rather than panels, and they resolve from a clean path
 * (/privacy, /terms) as well as from the hash — see the pathname handling in
 * router.js. Their text lives in the locale files like everything else, so both
 * languages stay in step.
 */

import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { logoMarkSvg } from '../ui/logo.js';

function section(titleKey, bodyKey) {
  return `<h2>${t(titleKey)}</h2><p>${t(bodyKey)}</p>`;
}

function page(titleKey, introKey, sections) {
  return `
    <div class="page"><div class="page-inner legal">
      <h1>${t(titleKey)}</h1>
      <p class="legal-date">${t('legal.updated')}</p>
      <p class="lede">${t(introKey)}</p>
      ${sections.map(([a, b]) => section(a, b)).join('')}
      <h2>${t('legal.contactHeading')}</h2>
      <p>${t('legal.contactBody')}</p>
      <div class="legal-foot">
        <div class="legal-mark">${logoMarkSvg()}</div>
        <button class="btn" data-go="home">${t('nav.backToMenu')}</button>
      </div>
    </div></div>`;
}

function wire(outlet) {
  outlet.addEventListener('click', (event) => {
    if (event.target.closest('[data-go="home"]')) navigate('home');
  });
}

export function mountPrivacy(outlet) {
  outlet.innerHTML = page('legal.privacyTitle', 'legal.privacyIntro', [
    ['legal.p1Title', 'legal.p1Body'],
    ['legal.p2Title', 'legal.p2Body'],
    ['legal.p3Title', 'legal.p3Body'],
    ['legal.p4Title', 'legal.p4Body'],
    ['legal.p5Title', 'legal.p5Body'],
    ['legal.p6Title', 'legal.p6Body'],
    ['legal.p7Title', 'legal.p7Body'],
  ]);
  wire(outlet);
}

export function mountTerms(outlet) {
  outlet.innerHTML = page('legal.termsTitle', 'legal.termsIntro', [
    ['legal.t1Title', 'legal.t1Body'],
    ['legal.t2Title', 'legal.t2Body'],
    ['legal.t3Title', 'legal.t3Body'],
    ['legal.t4Title', 'legal.t4Body'],
    ['legal.t5Title', 'legal.t5Body'],
    ['legal.t6Title', 'legal.t6Body'],
  ]);
  wire(outlet);
}
