/**
 * The quick replies, in one place.
 *
 * Two chats now — the lobby and the one beside the board — and a row of faces
 * that differed between them would read as two different features. They are
 * the same eight, in the same order, so the one you reach for in the lobby is
 * under the same finger during a game.
 *
 * Chosen to cover what gets said over a board and nothing else: hello, well
 * played, oh no, let me think. Nothing that could be read as a jeer.
 */
export const EMOJI = ['👋', '🙂', '😅', '🤔', '👏', '🔥', '😮', '🙃'];

/**
 * The row itself. Buttons rather than a picker: eight is few enough to show
 * all of them, and a picker is a second thing to open.
 *
 * Both callers handle the tap the same way — the mark goes into the box rather
 * than straight out as a message, because an emoji is usually the end of a
 * sentence rather than the whole of one.
 */
export function emojiRowHtml() {
  return `<div class="chat-emoji">${EMOJI.map((mark) =>
    `<button type="button" class="emoji" data-emoji="${mark}">${mark}</button>`).join('')}</div>`;
}
