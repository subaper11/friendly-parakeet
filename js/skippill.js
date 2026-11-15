// The turn-limit warning: a small pill that appears for the last 10 seconds of a turn ("the turn is skipped in N s"). Shared by local and online play; it only DISPLAYS a number.
// Local: js/game.js counts and skips. Online: the server counts and skips (js/online/session.js only asks it to, once the limit has run out).
let el = null, shown = '';
export const WARN_MS = 10000;
export function paintSkipPill(msLeft) {
  if (msLeft == null || msLeft > WARN_MS) { if (el && !el.hidden) { el.hidden = true; shown = ''; } return; }
  if (!el) { el = document.createElement('div'); el.id = 'skipPill'; el.className = 'skipPill'; el.setAttribute('role', 'timer'); document.body.append(el); }
  const s = Math.max(0, Math.ceil(msLeft / 1000)), text = s > 0 ? `يُتخطّى الدور بعد ${s} ث` : 'جارٍ تخطّي الدور…', low = s <= 5 ? '1' : '0';
  if (shown !== text) { el.textContent = text; shown = text; }
  if (el.dataset.low !== low) el.dataset.low = low;
  if (el.hidden) el.hidden = false;
}
