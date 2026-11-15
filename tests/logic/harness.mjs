import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');   // project root (fileURLToPath: URL.pathname is "/D:/..." on Windows)
export function boot(storage = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  // <dialog> polyfill: showModal sets `open`, close fires the 'close' event like a browser would
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.HTMLDialogElement.prototype.show = function () { this.setAttribute('open', ''); };   // the in-game dialogue is non-modal now
  w.HTMLDialogElement.prototype.close = function (rv) {
    if (rv !== undefined) this.returnValue = rv;
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open'); this.dispatchEvent(new w.Event('close'));
  };
  for (const k of ['window', 'document', 'localStorage', 'HTMLElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'DragEvent', 'Node', 'MutationObserver', 'CustomEvent', 'getComputedStyle', 'innerWidth', 'innerHeight', 'devicePixelRatio'])
    Object.defineProperty(globalThis, k, { value: k === 'window' ? w : w[k] ?? class {}, configurable: true, writable: true });
  return w;
}
// Click a <button value=...> inside a method=dialog form: sets returnValue and closes, like the browser does.
export const choose = (sel, value) => { const d = document.querySelector(sel); d.close(value); };
