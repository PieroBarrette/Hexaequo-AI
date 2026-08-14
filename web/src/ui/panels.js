/**
 * The two panels any screen can summon: rules and settings.
 *
 * Kept apart from main.js so that a view can open one without importing the
 * entry point, which would make the module graph circular.
 */

import { t } from '../i18n.js';
import { openOverlay, isOverlayOpen, overlayName, refreshOverlay } from './overlay.js';
import { mountRules } from '../views/rules.js';
import { mountSettings } from '../views/settings.js';
import { mountAccount } from '../views/account.js';

const PANELS = {
  rules: { title: () => t('rules.title'), mount: mountRules },
  settings: { title: () => t('settings.title'), mount: mountSettings },
  account: { title: () => t('account.title'), mount: mountAccount },
};

/** Open a panel over the current screen. Opening the same one again closes it. */
export function openPanel(name) {
  const panel = PANELS[name];
  if (!panel) return;
  openOverlay(name, panel.title(), panel.mount);
}

/** Re-render the open panel in the new language, if one is open. */
export function relabelPanel() {
  if (!isOverlayOpen()) return;
  const panel = PANELS[overlayName()];
  if (panel) refreshOverlay(panel.title(), panel.mount);
}
