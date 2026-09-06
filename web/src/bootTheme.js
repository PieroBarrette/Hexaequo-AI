/**
 * Theme and material before the first pixel.
 *
 * settings.js owns these attributes, but it is a module and modules run after
 * the document is parsed — so a light-theme visitor got a dark page first and
 * a flip a moment later. Harmless on a header; unmissable behind a full-screen
 * loader, which is what put this here.
 *
 * A file rather than an inline script, because the site's Content-Security
 * -Policy carries no 'unsafe-inline' and means it: every script is a file this
 * server serves. Written inline first, it was simply blocked in production —
 * the console said so and the dark flash came back — which is the policy doing
 * exactly its job.
 *
 * Loaded blocking from the head, so it runs before anything is painted. It
 * reads the same key settings.js writes and stops there: this is not a second
 * copy of the settings, it is the two attributes that decide the colour of the
 * first frame.
 */
(function () {
  try {
    var saved = JSON.parse(localStorage.getItem('hexaequo.settings') || '{}');
    var theme = saved.theme;
    if (!theme || theme === 'auto') {
      theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light' : 'dark';
    }
    var root = document.documentElement;
    root.setAttribute('data-theme', theme);
    if (saved.boardStyle) root.setAttribute('data-board-style', saved.boardStyle);
    /* The text scale too, for the same reason: a reader who asked for larger
       writing should not watch it grow after the first frame. */
    if (saved.textSize === 'large') root.setAttribute('data-text-size', 'large');
  } catch (e) { /* private mode, or nothing saved: the markup's default stands */ }
}());
