"""Graphics level setting (low = base game, default) + seat 3-4 panel accents. Run: python3 tests/e2e/fx.py"""
import subprocess, os
from pathlib import Path
from playwright.sync_api import sync_playwright
HERE = Path(__file__).parent; PORT = os.environ.get("PORT", "8772"); BASE = f"http://localhost:{PORT}"
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print("  FAIL:", m)
srv = subprocess.Popen(["node", str(HERE / "server.mjs")], env={**os.environ, "PORT": PORT}, stdout=subprocess.PIPE, text=True); srv.stdout.readline()
errors = []
PROBE = """() => {
  const q = (cls, extra) => { const d = document.createElement('div'); d.className = cls; document.body.append(d); const s = getComputedStyle(d); const o = { bf: s.backdropFilter, anim: s.animationName, shadow: s.boxShadow, bg: s.backgroundColor }; d.remove(); return o; };
  const dl = document.getElementById('dlg'), was = dl.classList.contains('dlgModal'); dl.classList.remove('dlgModal'); const dlg = getComputedStyle(dl); const dlgBf = dlg.backdropFilter; if (was) dl.classList.add('dlgModal');   // the floating (non-modal) look is the one with the blur
  return { fx: document.documentElement.dataset.fx, ov: q('mOv'), fd: q('fdOv'), tk: q('tkBackdrop'), pick: q('tile pick'), dlgBf };
}"""
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1100, "height": 800}); ctx.add_init_script("try{localStorage.setItem('scrabble.firstdraw','off');}catch(e){}"); pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e))); pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.goto(BASE + "/"); pg.wait_for_selector("#coverPlay")
        r = pg.evaluate(PROBE)
        none = lambda v: v in ("none", "")
        ok(r["fx"] == "low", f"a first-time visitor starts on low ({r['fx']})")
        ok(none(r["ov"]["bf"]) and none(r["fd"]["bf"]) and none(r["tk"]["bf"]) and none(r["dlgBf"]), f"low: no backdrop blur anywhere ({r['ov']['bf']}, {r['fd']['bf']}, {r['tk']['bf']}, {r['dlgBf']})")
        ok(r["pick"]["anim"] == "none" and r["pick"]["shadow"] != "none", f"low: the held tile has a steady ring, not a pulse ({r['pick']['anim']})")
        # the setting is reachable and works
        pg.click("#coverPlay"); pg.wait_for_selector("#md[open]"); pg.click("#mf .modeBtn >> nth=0"); pg.wait_for_selector("#sd[open]"); pg.click("#sf .btn >> nth=2"); pg.wait_for_selector("#dlg[open]"); pg.click("#dF .btn >> nth=0")
        pg.wait_for_function("document.querySelectorAll('#rk0 .tile').length===7")
        pg.click("#bSettings") if pg.locator("#bSettings").is_visible() else None
        pg.wait_for_selector("#rulesOpen", state="visible")
        pg.evaluate("document.getElementById('setMore').open = true")
        labels = pg.evaluate("[...document.querySelectorAll('#fxB button[data-v]')].map(b => b.dataset.v + ':' + b.getAttribute('aria-pressed'))")
        ok(labels == ["low:true", "mid:false", "high:false"], f"three levels, low selected ({labels})")
        pg.click("#fxB button[data-v='mid']"); r = pg.evaluate(PROBE)
        ok(r["fx"] == "mid" and "blur" in r["ov"]["bf"] and "blur" in r["fd"]["bf"] and "blur" in r["tk"]["bf"] and none(r["dlgBf"]), f"mid: blur behind the big overlays only ({r['ov']['bf']}, dialog {r['dlgBf']})")
        ok(r["pick"]["anim"] == "blink", f"mid: the held tile pulses again ({r['pick']['anim']})")
        pg.click("#fxB button[data-v='high']"); r = pg.evaluate(PROBE)
        ok(r["fx"] == "high" and "blur" in r["dlgBf"], f"high: blur behind the floating dialogue too ({r['dlgBf']})")
        ok(pg.evaluate("localStorage.getItem('eas.fx')") == "high", "the choice is stored on this device")
        pg.reload(); pg.wait_for_selector("#coverPlay")
        ok(pg.evaluate("document.documentElement.dataset.fx") == "high", "the choice survives a reload")
        pg.evaluate("localStorage.setItem('eas.fx','bogus')"); pg.reload(); pg.wait_for_selector("#coverPlay")
        ok(pg.evaluate("document.documentElement.dataset.fx") == "low", "an invalid stored value falls back to low")
        # seat 3-4 panel accents differ from seats 1-2
        acc = pg.evaluate("['pn0','pn1','pn2','pn3'].map(id => { let e = document.getElementById(id), tmp = !e; if (tmp) { e = document.createElement('div'); e.id = id; document.body.append(e); } const v = getComputedStyle(e).getPropertyValue('--pc').trim(); if (tmp) e.remove(); return v; })")   # seats 3-4 exist only in online rooms: probe the rule with a temporary element
        ok(len(set(acc)) == 4 and all(acc), f"four seats, four panel accents ({acc})")
        br.close()
finally:
    srv.terminate()
real = [e for e in errors if "favicon" not in e]
ok(not real, f"no browser errors: {real[:3]}")
print(f"{passed} passed, {failed} failed")
