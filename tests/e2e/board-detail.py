"""Board detail levels, four player colours and the last-move ring. Run: python3 tests/e2e/board-detail.py  (SHOTS=/dir saves screenshots)"""
import subprocess, os
from pathlib import Path
from playwright.sync_api import sync_playwright
HERE = Path(__file__).parent; PORT = os.environ.get("PORT", "8771"); BASE = f"http://localhost:{PORT}"; SHOTS = os.environ.get("SHOTS")
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print("  FAIL:", m)
srv = subprocess.Popen(["node", str(HERE / "server.mjs")], env={**os.environ, "PORT": PORT}, stdout=subprocess.PIPE, text=True); srv.stdout.readline()
errors = []
SEED = """async () => {
  const { S } = await import('/js/state.js'); const ui = await import('/js/ui.js');
  const mk = (id, l, v, o) => ({ id, l, v, blank: false, as: null, o });
  const word = (r, c0, letters, o) => letters.forEach((l, k) => { S.board[r][c0 + k] = mk(900 + r * 20 + k, l, 1 + k % 4, o); });
  word(7, 4, ['ك','ت','ا','ب'], 0); word(8, 4, ['ل','ع','ب'], 1); word(9, 4, ['س','م','ا'], 2); word(10, 4, ['ن','و','ر'], 3);
  S.lastMove = new Set([7 * 15 + 4, 7 * 15 + 5, 8 * 15 + 4, 9 * 15 + 4, 10 * 15 + 4]);
  ui.render();
}"""
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        for name, vp, level in (("wide", {"width": 1280, "height": 800}, "full"), ("phone", {"width": 390, "height": 780}, "short"), ("tiny", {"width": 300, "height": 640}, "none")):
            ctx = br.new_context(viewport=vp); ctx.add_init_script("try{localStorage.setItem('scrabble.firstdraw','off');}catch(e){}"); pg = ctx.new_page()
            pg.on("pageerror", lambda e: errors.append(str(e))); pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            pg.goto(BASE + "/"); pg.wait_for_selector("#coverPlay"); pg.click("#coverPlay"); pg.wait_for_selector("#md[open]")
            pg.click("#mf .modeBtn >> nth=0"); pg.wait_for_selector("#sd[open]"); pg.click("#sf .btn >> nth=2"); pg.wait_for_selector("#dlg[open]"); pg.click("#dF .btn >> nth=0")
            pg.wait_for_function("document.querySelectorAll('#rk0 .tile').length===7"); pg.evaluate(SEED)
            bw = pg.evaluate("document.getElementById('board').getBoundingClientRect().width")
            vis = lambda sel: pg.evaluate("s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' }", sel)
            w, ws, pl, val = vis(".k1 .pl .w, .k2 .pl .w, .k3 .pl .w, .k4 .pl .w"), vis(".pl .ws"), vis(".k1 .pl, .k2 .pl, .k3 .pl, .k4 .pl"), vis(".sq .tile i")
            ok((level == "full" and w and not ws and val) or (level == "short" and ws and not w and pl and val) or (level == "none" and not pl), f"{name} ({bw:.0f}px board): level {level}: full-word={w} short={ws} label={pl} value={val}")
            if level == "none": ok(not val, f"{name}: tile values are hidden on the smallest board")
            else: ok(val, f"{name}: tile values are shown")
            cols = pg.evaluate("[0,1,2,3].map(o => { const e = document.querySelector(`.sq.lm[data-lo=\"${o}\"]`); return e ? getComputedStyle(e, '::after').borderTopColor : null })")
            tok = pg.evaluate("['--tile-p1','--tile-p2','--tile-p3','--tile-p4'].map(v => { const d = document.createElement('i'); d.style.color = `var(${v})`; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c })")
            ok(all(c is not None for c in cols[:3]) and cols[:3] == tok[:3], f"{name}: the ring takes each player's colour ({cols} vs {tok})")
            anim = pg.evaluate("(() => { const e = document.querySelector('.sq.lm'); const s = getComputedStyle(e, '::after'); return [s.animationName, s.boxShadow, s.filter] })()")
            ok(anim[0] == "none" and anim[1] == "none" and anim[2] == "none", f"{name}: the ring has no animation, shadow or filter ({anim})")
            letters = pg.evaluate("[0,1,2,3].map(o => { const e = document.querySelector(`.sq .tile[data-o=\"${o}\"] b`); return e ? getComputedStyle(e).color : null })")
            ok(letters == tok, f"{name}: four players, four letter colours ({letters})")
            if SHOTS: pg.locator("#board").screenshot(path=f"{SHOTS}/detail-{name}.png")
            ctx.close()
        br.close()
finally:
    srv.terminate()
real = [e for e in errors if "favicon" not in e]
ok(not real, f"no browser errors: {real[:3]}")
print(f"{passed} passed, {failed} failed")
