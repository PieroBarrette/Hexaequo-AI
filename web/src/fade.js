/**
 * One cross-fade for anything that repaints the whole page.
 *
 * Three things do: a change of theme or material, a change of language, and
 * a change of view. Each used to land in a single frame — dark to light, one
 * language to the other, one screen to the next — and a whole page changing
 * at once reads as a flash. A transition on every element's colour would
 * catch some of it, but not the gradients behind the board, which do not
 * animate, and not a page whose words or layout have changed.
 *
 * The View Transitions API cross-fades the page as a whole instead: the
 * browser keeps the old frame, runs the update, and dissolves the old frame
 * into the new one — gradients, SVG and all — in one ramp of opacity. How
 * long, per kind, is set in app.css against the data-fade attribute this
 * leaves on <html> while the fade runs.
 *
 * Browsers without the API — Safari before 18, Firefox before 144 — run the
 * update at once, as they always did. So does a tab nobody is looking at,
 * where a fade would wait for the tab to come back and hold the change with
 * it. And so does an update asked for from inside another one — the language
 * changing remounts the view, and the router asks for a fade of its own —
 * which simply joins the fade already under way.
 */

let inside = false;   // an update is running: anything asked for now joins it
let latest = 0;       // which fade owns the attribute on <html>

export function crossFade(update, kind = 'look') {
  if (inside || typeof document.startViewTransition !== 'function'
    || document.visibilityState === 'hidden') {
    update();
    return;
  }
  const root = document.documentElement;
  const token = ++latest;
  root.setAttribute('data-fade', kind);
  const transition = document.startViewTransition(() => {
    inside = true;
    /* An update that throws is reported the way it would have been without
       the fade — as an uncaught error — rather than folded into a promise
       nobody reads. */
    try { update(); }
    catch (error) { reportError(error); }
    finally { inside = false; }
  });
  /* The browser runs the update only when it next paints a frame, and a
     window that is covered but not hidden may not paint one for seconds —
     Chrome then gives up after four, logs an error nobody asked for, and runs
     it. A second is longer than any fade here: past it, drop the fade and run
     the update. Settled either way, the promise stops the timer and takes the
     attribute back, unless a newer fade has claimed it since. */
  const guard = setTimeout(() => transition.skipTransition(), 1000);
  const settled = () => {
    clearTimeout(guard);
    if (token === latest) root.removeAttribute('data-fade');
  };
  transition.finished.then(settled, settled);
  /* Dropping the fade rejects this one too, and Chrome reports it as an
     uncaught error unless somebody has said they do not mind. */
  transition.ready.catch(() => {});
}
