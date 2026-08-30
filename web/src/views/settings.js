/** Site settings, with a live preview of the chosen material and theme. */

import { t } from '../i18n.js';
import { get as getSetting, set as setSetting } from '../settings.js';
import { play, setVolume } from '../audio.js';
import { miniBoardSvg } from '../ui/miniBoard.js';
import { checkNow, serverBuild } from '../update.js';
import { BLACK, WHITE, DISK, RING } from '../game/state.js';

/** Deferred install prompt, captured in main.js. */
let installPrompt = null;
export function setInstallPrompt(event) { installPrompt = event; }

const PREVIEW = {
  tiles: [[0, 0, BLACK], [1, 0, BLACK], [-1, 1, WHITE], [0, 1, WHITE], [1, 1, BLACK], [-1, 2, WHITE]],
  pieces: [[1, 0, BLACK, DISK], [-1, 1, WHITE, DISK], [0, 1, BLACK, RING], [1, 1, WHITE, RING]],
  spots: [[2, 0], [0, 2]],
};

function segmented(name, value, options) {
  return `<div class="segmented" role="group">`
    + options.map((o) => `<button data-set="${name}" data-value="${o.value}"`
      + ` class="${String(value) === String(o.value) ? 'is-active' : ''}">${o.label}</button>`).join('')
    + `</div>`;
}

function toggle(name, value) {
  return `<button class="switch" role="switch" data-toggle="${name}"`
    + ` aria-checked="${value ? 'true' : 'false'}"`
    + ` aria-label="${t('settings.' + name)}"></button>`;
}

function row(titleKey, hintKey, control) {
  /* A row holding a switch answers to a tap anywhere along it. The switch
     itself is 50x29, which is smaller than a fingertip lands reliably, and
     missing it looked like the switch was stuck rather than unhit. */
  const switchable = control.includes('data-toggle=');
  return `<div class="setting${switchable ? ' is-switchable' : ''}">
    <div class="setting-label"><b>${t(titleKey)}</b><small>${t(hintKey)}</small></div>
    ${control}
  </div>`;
}

export function mountSettings(outlet) {
  function render() {
    const installable = !!installPrompt;
    const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;

    outlet.innerHTML = `
      <div class="page"><div class="page-inner">
        <h1>${t('settings.title')}</h1>
        <p class="lede">${t('settings.lede')}</p>

        ${row('settings.language', 'settings.languageHint', segmented('language', getSetting('language'), [
          { value: 'fr', label: 'Français' }, { value: 'en', label: 'English' }]))}

        ${row('settings.theme', 'settings.themeHint', segmented('theme', getSetting('theme'), [
          { value: 'auto', label: t('settings.themeAuto') },
          { value: 'light', label: t('settings.themeLight') },
          { value: 'dark', label: t('settings.themeDark') }]))}

        ${row('settings.boardStyle', 'settings.boardStyleHint', segmented('boardStyle', getSetting('boardStyle'), [
          { value: 'classic', label: t('settings.styleClassic') },
          { value: 'modern', label: t('settings.styleModern') }]))}

        <h2>${t('settings.preview')}</h2>
        <div class="preview-board">${miniBoardSvg(PREVIEW)}</div>

        <h2>${t('game.mode')}</h2>
        ${row('settings.showValidMoves', 'settings.showValidMovesHint', toggle('showValidMoves', getSetting('showValidMoves')))}
        ${row('settings.showLastMove', 'settings.showLastMoveHint', toggle('showLastMove', getSetting('showLastMove')))}
        ${row('settings.premove', 'settings.premoveHint', toggle('premove', getSetting('premove')))}
        ${row('settings.aiLevel', 'settings.aiLevelHint', segmented('aiLevel', getSetting('aiLevel'), [
          { value: 0, label: t('game.levelBeginner') },
          { value: 1, label: t('game.levelEasy') },
          { value: 2, label: t('game.levelMedium') },
          { value: 3, label: t('game.levelStrong') }]))}

        <h2>${t('settings.sound')}</h2>
        ${row('settings.sound', 'settings.soundHint', toggle('sound', getSetting('sound')))}
        ${row('settings.volume', 'settings.soundHint',
          `<input type="range" min="0" max="1" step="0.05" value="${getSetting('volume')}" data-range="volume">`)}
        ${row('settings.tryTheSounds', 'settings.tryTheSoundsHint',
          `<button class="btn" data-action="demo">${t('settings.playSample')}</button>`)}

        <h2>${t('update.heading')}</h2>
        ${row('update.heading', 'update.hint',
          `<button class="btn" data-action="check-update">${t('update.check')}</button>`)}
        <p class="lede version-line" style="font-size:12px;margin-top:-4px"></p>

        <h2>${t('settings.install')}</h2>
        ${row('settings.install', 'settings.installHint',
          standalone
            ? `<span class="setting-label"><small>${t('settings.installed')}</small></span>`
            : installable
              ? `<button class="btn btn--primary" data-action="install">${t('settings.installAction')}</button>`
              : `<span class="setting-label"><small>${t('settings.installUnavailable')}</small></span>`)}
      </div></div>`;
  }

  render();

  /* The build the server is on. Useful when someone reports a problem that was
     fixed a week ago: the number says whether they are actually running it. */
  serverBuild().then((build) => {
    const line = outlet.querySelector('.version-line');
    if (line && build && !line.textContent) line.textContent = 'build ' + build;
  });

  outlet.addEventListener('click', async (event) => {
    const seg = event.target.closest('[data-set]');
    if (seg) {
      const name = seg.getAttribute('data-set');
      let value = seg.getAttribute('data-value');
      if (name === 'aiLevel') value = Number(value);
      setSetting(name, value);
      // The material is a voice as much as a look: play it, not a click.
      play(name === 'boardStyle' ? 'piecePlacement' : 'ui');
      if (name !== 'language') render();   // a language change re-mounts the view
      return;
    }
    /* Either the switch itself, or anywhere on the row that holds one. */
    const switchRow = event.target.closest('.setting.is-switchable');
    const sw = event.target.closest('[data-toggle]')
      || (switchRow ? switchRow.querySelector('[data-toggle]') : null);
    if (sw) {
      const name = sw.getAttribute('data-toggle');
      setSetting(name, !getSetting(name));
      play('ui');
      render();
      return;
    }
    const action = event.target.closest('[data-action]');
    if (action && action.getAttribute('data-action') === 'check-update') {
      const line = outlet.querySelector('.version-line');
      const button = action;
      button.disabled = true;
      if (line) line.textContent = t('update.checking');
      const answer = await checkNow();
      button.disabled = false;
      if (line) {
        line.textContent = {
          ready: t('update.available'),
          current: t('update.current'),
          offline: t('update.offline'),
          unsupported: t('update.unsupported'),
        }[answer] || '';
      }
      return;
    }
    if (action && action.getAttribute('data-action') === 'demo') {
      // A move, a placement and a capture, spaced as they would fall in play.
      play('move');
      play('tilePlacement', 380);
      play('capture', 820);
      play('win', 1400);
      return;
    }
    if (action && action.getAttribute('data-action') === 'install' && installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice.catch(() => {});
      installPrompt = null;
      render();
    }
  });

  outlet.addEventListener('input', (event) => {
    const range = event.target.closest('[data-range]');
    if (!range) return;
    const value = Number(range.value);
    setSetting('volume', value);
    setVolume(value);
  });

  outlet.addEventListener('change', (event) => {
    if (event.target.closest('[data-range]')) play('ui');
  });
}
