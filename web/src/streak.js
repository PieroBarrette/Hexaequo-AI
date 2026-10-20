/**
 * Days in a row, said the way your own profile and the card at the end of a
 * game say them.
 *
 * The server does the counting, from the games it has written. Only the
 * browser knows where midnight is for the person reading, so every question
 * about the streak names the zone it is asked from — and nothing about it is
 * kept anywhere but in the games themselves.
 */

import { t } from './i18n.js';

const escapeText = (value) => String(value).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The zone this browser is in, as an IANA name. */
export function timeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

/** An API path with the zone added to it. */
export function withZone(path) {
  return `${path}${path.includes('?') ? '&' : '?'}tz=${encodeURIComponent(timeZone())}`;
}

/**
 * The line under your name: the days running, whether today is already in
 * them, and the best there has been when it is more. Nothing at all for
 * somebody who has never yet had a day that counted.
 */
export function profileStreakHtml(streak) {
  if (!streak || !(streak.best > 0)) return '';
  const parts = [];
  if (streak.current > 0) {
    parts.push(`<b>${escapeText(t('profile.streak', { n: streak.current }))}</b>`);
    parts.push(escapeText(t(streak.playedToday ? 'profile.streakToday' : 'profile.streakKeep')));
  } else {
    parts.push(escapeText(t('profile.streakNone')));
  }
  if (streak.best > streak.current) parts.push(escapeText(t('profile.streakBest', { n: streak.best })));
  return parts.join(' · ');
}

/**
 * The line on the card, once the game is written: the days running with today
 * in them, and a +1 when this was the game that carried the streak into today.
 * Nothing when today has nothing that counts — a game against yourself, or a
 * room left before a move was made.
 */
export function cardStreakHtml(streak) {
  if (!streak || !streak.playedToday || !(streak.current > 0)) return '';
  const line = escapeText(t('result.streak', { n: streak.current }));
  return streak.today === 1 && streak.current > 1 ? `${line} <span class="is-up">+1</span>` : line;
}
