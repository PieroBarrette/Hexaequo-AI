/** Site settings, with a live preview of the chosen material and theme. */

import { t } from '../i18n.js';
import { get as getSetting, set as setSetting } from '../settings.js';
import { play, setVolume } from '../audio.js';
import { miniBoardSvg } from '../ui/miniBoard.js';
import { checkNow, serverBuild } from '../update.js';
import { BLACK, WHITE, DISK, RING } from '../game/state.js';
import {
  deviceState, enable as enablePush, disable as disablePush, sendTest as sendPushTest,
} from '../push.js';
import { onAuthChange } from '../auth.js';

const escapeText = (value) => String(value).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Deferred install prompt, captured in main.js. */
let installPrompt = null;
export function setInstallPrompt(event) { installPrompt = event; }

/*
 * The preview answers to the switches above it.
 *
 * Theme and material it always showed; the rest it did not, so three switches
 * claimed to change how the board looks over a picture of a board that never
 * changed. Each option that draws something now draws it here: the dashed
 * candidate cells, the trace of the move just played, the coordinates round the
 * rim. Turning one off takes it out of the picture, which is the shortest way
 * to answer "what does this actually do".
 */
function previewSpec() {
  const aid = Boolean(getSetting('showValidMoves'));
  return {
    tiles: [[0, 0, BLACK], [1, 0, BLACK], [-1, 1, WHITE], [0, 1, WHITE], [1, 1, BLACK], [-1, 2, WHITE]],
    pieces: [[1, 0, BLACK, DISK], [-1, 1, WHITE, DISK], [0, 1, BLACK, RING], [1, 1, WHITE, RING]],
    /* Cells touching two tiles: where a tile may go, which is half of what the
       move aid marks. The other half is where a piece may go, so the preview
       shows one of each rather than claiming the switch does less than it
       does. */
    spots: [[2, 0], [0, 2]],
    showSpots: aid,
    /* On an empty tile next to a piece of the same colour, because that is
       where a destination can actually be: marking a cell with no tile on it
       would be showing something the board never shows. */
    dots: aid ? [[0, 0, 'move']] : [],
    lastMove: getSetting('showLastMove') ? [[1, 1]] : [],
    /* The cells are named in the picture whenever naming them is something you
       have asked for at all — under `auto` that is in a review, and a still
       picture of a board is the closest this panel gets to one. */
    coords: getSetting('showCoordinates') !== 'never'
      && getSetting('showCoordinates') !== false,
  };
}

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
  /* What this device says about notifications, asked once and again after
     anything that could change the answer. Null until the first answer. */
  let device = null;
  let pushBusy = false;
  let pushNote = '';

  async function refreshDevice() {
    device = await deviceState().catch(() => null);
    render();
  }

  /**
   * The notifications section.
   *
   * One switch for this device, and under it — once it is on — one per kind
   * of notification. Where the switch cannot work, the row says why and what
   * to do instead, rather than offering something that would do nothing: an
   * iPhone in a Safari tab, a browser that cannot, a refusal already given.
   */
  function notificationRows() {
    const say = (hintKey, control = '') => row('settings.notifyDevice', hintKey, control);
    if (!device) return say('settings.notifyDeviceHint', '<span class="setting-label"><small>…</small></span>');
    if (device.support === 'install') return say('settings.notifyInstall');
    if (device.support !== 'ok') return say('settings.notifyUnsupported');
    if (!device.available) return say('settings.notifyUnavailable');
    if (!device.signedIn) {
      return say('settings.notifySignIn', `<button class="btn" data-action="sign-in">${t('account.signIn')}</button>`);
    }
    if (device.permission === 'denied') return say('settings.notifyDenied');

    const hint = pushBusy ? 'settings.notifyAsking'
      : (device.on ? 'settings.notifyOnHint' : 'settings.notifyDeviceHint');
    let out = say(hint, `<button class="switch" role="switch" data-toggle="notifications"`
      + ` aria-checked="${device.on ? 'true' : 'false'}" aria-label="${t('settings.notifyDevice')}"`
      + `${pushBusy ? ' aria-busy="true"' : ''}></button>`);
    if (device.on) {
      for (const name of ['notifyChallenges', 'notifyGames', 'notifyMentions', 'notifyReminders']) {
        out += row(`settings.${name}`, `settings.${name}Hint`, toggle(name, getSetting(name)));
      }
      out += row('settings.notifyTest', 'settings.notifyTestHint',
        `<button class="btn" data-action="push-test">${t('settings.notifyTestAction')}</button>`);
    }
    if (pushNote) {
      out += `<p class="lede push-note" style="font-size:12px;margin-top:-4px">${escapeText(pushNote)}</p>`;
    }
    return out;
  }

  /*
   * Called straight from the tap, with nothing awaited first: the permission
   * question only appears inside the gesture that asked for it.
   */
  function togglePush() {
    if (pushBusy || !device) return;
    const job = device.on ? disablePush() : enablePush();
    pushBusy = true;
    pushNote = '';
    render();
    job.then((answer) => {
      pushBusy = false;
      if (answer && !answer.ok && !['DENIED', 'DISMISSED'].includes(answer.error)) {
        pushNote = t('settings.notifyFailed');
      }
      return refreshDevice();
    });
  }

  function render() {
    const installable = !!installPrompt;
    const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;

    outlet.innerHTML = `
      <div class="page"><div class="page-inner">
        <h1>${t('settings.title')}</h1>
        <h2>${t('settings.appearance')}</h2>
        ${row('settings.language', 'settings.languageHint', segmented('language', getSetting('language'), [
          { value: 'fr', label: 'Français' }, { value: 'en', label: 'English' }]))}

        ${row('settings.theme', 'settings.themeHint', segmented('theme', getSetting('theme'), [
          { value: 'auto', label: t('settings.themeAuto') },
          { value: 'light', label: t('settings.themeLight') },
          { value: 'dark', label: t('settings.themeDark') }]))}

        ${row('settings.boardStyle', 'settings.boardStyleHint', segmented('boardStyle', getSetting('boardStyle'), [
          { value: 'classic', label: t('settings.styleClassic') },
          { value: 'modern', label: t('settings.styleModern') }]))}

        ${row('settings.textSize', 'settings.textSizeHint', segmented('textSize', getSetting('textSize'), [
          { value: 'normal', label: t('settings.textNormal') },
          { value: 'large', label: t('settings.textLarge') }]))}

        <h2>${t('settings.preview')}</h2>
        <div class="preview-board">${miniBoardSvg(previewSpec())}</div>

        <h2>${t('settings.boardSection')}</h2>
        ${row('settings.showValidMoves', 'settings.showValidMovesHint', toggle('showValidMoves', getSetting('showValidMoves')))}
        ${row('settings.showLastMove', 'settings.showLastMoveHint', toggle('showLastMove', getSetting('showLastMove')))}
        ${row('settings.showCoordinates', 'settings.showCoordinatesHint',
          segmented('showCoordinates', getSetting('showCoordinates'), [
            { value: 'auto', label: t('settings.coordsAuto') },
            { value: 'always', label: t('settings.coordsAlways') },
            { value: 'never', label: t('settings.coordsNever') }]))}

        <h2>${t('settings.animations')}</h2>
        ${row('settings.animateMoves', 'settings.animateMovesHint', toggle('animateMoves', getSetting('animateMoves')))}
        ${row('settings.animatePlacement', 'settings.animatePlacementHint', toggle('animatePlacement', getSetting('animatePlacement')))}

        <h2>${t('settings.sound')}</h2>
        ${row('settings.sound', 'settings.soundHint', toggle('sound', getSetting('sound')))}
        ${row('settings.soundVoice', 'settings.soundVoiceHint', segmented('soundVoice', getSetting('soundVoice'), [
          { value: 'melodic', label: t('settings.voiceMelodic') },
          { value: 'percussive', label: t('settings.voicePercussive') }]))}
        ${row('settings.volume', 'settings.soundHint',
          `<input type="range" min="0" max="1" step="0.05" value="${getSetting('volume')}" data-range="volume">`)}
        ${row('settings.tryTheSounds', 'settings.tryTheSoundsHint',
          `<button class="btn" data-action="demo">${t('settings.playSample')}</button>`)}

        <h2>${t('settings.gameSection')}</h2>
        ${row('settings.premove', 'settings.premoveHint', toggle('premove', getSetting('premove')))}
        ${row('settings.confirmMove', 'settings.confirmMoveHint',
          toggle('confirmMove', getSetting('confirmMove')))}
        ${row('settings.aiLevel', 'settings.aiLevelHint', segmented('aiLevel', getSetting('aiLevel'), [
          { value: 0, label: t('game.levelBeginner') },
          { value: 1, label: t('game.levelEasy') },
          { value: 2, label: t('game.levelMedium') },
          { value: 3, label: t('game.levelStrong') }]))}

        <h2>${t('settings.notifications')}</h2>
        ${notificationRows()}

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
  refreshDevice();

  /* Signing in or out changes what the switch can be; so does coming back from
     the system's settings, where the permission may just have been granted. */
  const stopAuth = onAuthChange(() => refreshDevice());
  const onReturn = () => { if (document.visibilityState === 'visible') refreshDevice(); };
  document.addEventListener('visibilitychange', onReturn);

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
      play('ui');
      // Not a setting: the device itself, its permission and subscription.
      if (name === 'notifications') { togglePush(); return; }
      setSetting(name, !getSetting(name));
      render();
      return;
    }
    const action = event.target.closest('[data-action]');
    if (action && action.getAttribute('data-action') === 'sign-in') {
      /* Imported when pressed: the panels module imports this view, and
         importing it back at load would tie the two in a circle. */
      import('../ui/panels.js').then(({ openPanel }) => openPanel('account'));
      return;
    }
    if (action && action.getAttribute('data-action') === 'push-test') {
      action.disabled = true;
      const answer = await sendPushTest();
      pushNote = answer.ok ? t('settings.notifyTestSent') : t('settings.notifyTestFailed');
      render();
      return;
    }
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

  return () => {
    stopAuth();
    document.removeEventListener('visibilitychange', onReturn);
  };
}
