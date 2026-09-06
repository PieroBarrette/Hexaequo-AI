/**
 * The symbols on the game's controls, drawn rather than typed.
 *
 * They were characters — ⋯ ↶ ½ ⚑ ☰ ⟳ — and a character is whatever the
 * phone's font makes of it: a hair-thin ellipsis on one, an emoji-coloured flag
 * on another, and all of them sized by a font-size that was chosen for words.
 * A drawn symbol is the same shape everywhere, takes its colour from the text
 * around it, and is sized like a symbol: by a width, in pixels, that the
 * stylesheet owns.
 *
 * Every icon sits on the same 24-unit grid with the same two-unit stroke, so
 * a row of them reads as one set. Strokes are `currentColor`, so a button that
 * turns accent-coloured when it is on takes its symbol with it.
 */

const SHAPES = {
  /* Three dots: the menu that holds what the bar could not fit. */
  menu: '<circle cx="5" cy="12" r="2.1" fill="currentColor" stroke="none"/>'
    + '<circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none"/>'
    + '<circle cx="19" cy="12" r="2.1" fill="currentColor" stroke="none"/>',
  /* Round again: a new game. */
  restart: '<path d="M20.5 12a8.5 8.5 0 1 1-2.9-6.4"/><path d="M20.5 3.5V9h-5.5"/>',
  /* A step back. */
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  /* Half a disk: an ExAequo. */
  draw: '<circle cx="12" cy="12" r="8.5"/>'
    + '<path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" stroke="none"/>',
  /* The flag that is laid down. */
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1Z"/><path d="M4 22v-7"/>',
  /* Lines of a list: the moves. */
  list: '<path d="M8 6h13M8 12h13M8 18h13"/>'
    + '<circle cx="3.5" cy="6" r="1.2" fill="currentColor" stroke="none"/>'
    + '<circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none"/>'
    + '<circle cx="3.5" cy="18" r="1.2" fill="currentColor" stroke="none"/>',
  /* And the same button once the list is up: it goes back down. */
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  /* Out of a branch, to the end of the real game. */
  exit: '<path d="M3 12h14"/><path d="m11 6 6 6-6 6"/><path d="M21 5v14"/>',
  /* Through a game: to the start, one back, one on, to the end. */
  first: '<path d="M19 20 9 12l10-8Z" fill="currentColor"/><path d="M5 19V5"/>',
  prev: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  last: '<path d="M5 4l10 8-10 8Z" fill="currentColor"/><path d="M19 5v14"/>',
  /* Playing it back, and the engines running. */
  play: '<path d="M7 4.5 19 12 7 19.5Z" fill="currentColor"/>',
  pause: '<path d="M7 4h3.5v16H7ZM13.5 4H17v16h-3.5Z" fill="currentColor" stroke="none"/>',
  /* One move from the engine, then it waits again. */
  step: '<path d="M5 4l10 8-10 8Z" fill="currentColor"/><path d="M19 5v14"/>',
};

/**
 * One icon, inline. Sized by the stylesheet (`.ico` has no width of its own),
 * hidden from screen readers because the button it sits in carries the words.
 */
export function icon(name) {
  const shape = SHAPES[name];
  if (!shape) return '';
  return `<svg class="ico ico-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor"`
    + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
    + ` aria-hidden="true" focusable="false">${shape}</svg>`;
}

export const ICON_NAMES = Object.keys(SHAPES);
