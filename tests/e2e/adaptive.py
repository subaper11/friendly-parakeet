"""Adaptive alif (v5.6 mode, ported into 6.2) + How-to-play tabbed view, in a real browser (local play). Run: python3 tests/e2e/adaptive.py"""
import subprocess, os
from pathlib import Path
from playwright.sync_api import sync_playwright
HERE = Path(__file__).parent; PORT = os.environ.get("PORT", "8769"); BASE = f"http://localhost:{PORT}"; SHOTS = os.environ.get("SHOTS")
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print("  FAIL:", m)
srv = subprocess.Popen(["node", str(HERE / "server.mjs")], env={**os.environ, "PORT": PORT}, stdout=subprocess.PIPE, text=True); srv.stdout.readline()
errors = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        for name, vp in (("desktop", {"width": 1280, "height": 800}), ("phone", {"width": 390, "height": 780})):
            ctx = br.new_context(viewport=vp); ctx.add_init_script("try{if(!sessionStorage.getItem('fd')){localStorage.setItem('scrabble.firstdraw','off');}}catch(e){}"); pg = ctx.new_page()
            pg.on("pageerror", lambda e: errors.append(str(e))); pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            ev = lambda expr: pg.evaluate("async () => { const m = await import('/js/state.js'); const {S, app} = m; return (" + expr + ") }")
            pg.goto(BASE + "/"); pg.wait_for_selector("#coverPlay"); pg.click("#coverPlay"); pg.wait_for_selector("#md[open]")
            ids = pg.evaluate("[...document.querySelectorAll('#mf .modeBtn')].map(b => b.value)")
            ok("adaptive" in ids, f"{name}: the adaptive mode is offered ({ids})")
            pg.click(f"#mf .modeBtn[value='adaptive']"); pg.wait_for_selector("#sd[open]"); pg.click("#sf .btn >> nth=2")
            pg.wait_for_selector("#dlg[open]"); pg.click("#dF .btn >> nth=0")
            pg.wait_for_function("document.querySelectorAll('#rk0 .tile').length===7")
            ok(ev("app.mode") == "adaptive" and ev("S.bag.length + S.players.reduce((n,p)=>n+p.rack.filter(Boolean).length,0)") == 91, f"{name}: 91 tiles in the adaptive bag")
            # put an adaptive alif on player 0's rack slot 0 (swap with one from the bag)
            ev("(() => { const i = S.bag.findIndex(t => t.flex); const t = S.bag.splice(i, 1)[0]; const old = S.players[0].rack[0]; S.players[0].rack[0] = t; S.bag.push(old); return 1 })()")
            pg.evaluate("async () => { const m = await import('/js/ui.js'); m.render(); }")
            try: pg.wait_for_selector("#rk0 .tile.flex.open", timeout=3000)
            except Exception: pass
            ok(pg.locator("#rk0 .tile.flex.open").count() >= 1, f"{name}: the unresolved adaptive alif has its own look")
            if SHOTS: pg.screenshot(path=f"{SHOTS}/{name}-rack.png")
            pg.click("#rk0 .tile.flex.open >> nth=0"); pg.click("#board > .sq:nth-child(%d)" % (7 * 15 + 7 + 1))
            pg.wait_for_selector("#bd[open]")
            forms = pg.evaluate("[...document.querySelectorAll('#bf .btn')].map(b => b.value)")
            ok(len(forms) == 8 and "ئـ" in forms and "ئ" in forms and "ض" not in forms, f"{name}: the picker offers the 8 alif forms only ({forms})")
            if SHOTS: pg.screenshot(path=f"{SHOTS}/{name}-picker.png")
            pg.click("#bf .btn >> nth=1"); pg.wait_for_function("!document.getElementById('bd').open")
            pg.wait_for_function("document.querySelectorAll('#board .tile.flex').length===1")
            ok(pg.locator("#board .tile.flex:not(.open)").count() == 1 and ev("S.move[0].t.as") == forms[1], f"{name}: placed as {forms[1]}, value kept ({pg.locator('#board .tile.flex').count()} flex on board, as={ev('S.move[0] && S.move[0].t.as')}, open={pg.locator('#board .tile.flex.open').count()})")
            ok(ev("S.move[0].t.v") == 1, f"{name}: the adaptive alif is worth 1, not 0")
            # How to play: tabs, the letters tab shows every mode
            pg.click("#bSettings") if pg.locator("#bSettings").is_visible() else None
            pg.wait_for_selector("#rulesOpen", state="visible"); pg.click("#rulesOpen"); pg.wait_for_selector("#rd[open]")
            tabs = pg.evaluate("[...document.querySelectorAll('#rdTabs [data-tab]')].map(b => b.dataset.tab)")
            ok(tabs == ["basics", "scoring", "letters", "words", "tahkim"], f"{name}: five tabs ({tabs})")
            pg.click("#rdTab-letters"); ok(pg.locator("#rdBody .rdChip").count() == 3, f"{name}: letters tab has a chip per mode")
            pg.click("#rdBody .rdChip[data-mode='adaptive']"); ok("ألف مرنة" in pg.inner_text("#rdBody"), f"{name}: the adaptive mode is explained")
            pg.click("#rdBody .rdChip[data-mode='expanded']"); ok("ئـ" in pg.inner_text("#rdBody") and "ئ" in pg.inner_text("#rdBody"), f"{name}: expanded lists both hamza-on-ya tiles")
            pg.click("#rdTab-words"); ok("المضارع" not in pg.inner_text("#rdBody"), f"{name}: the lam-on-present-verb rule is gone")
            pg.click("#rdTab-basics"); ok("3 أو 4" in pg.inner_text("#rdBody"), f"{name}: rules mention 3-4 player rooms")
            if SHOTS: pg.screenshot(path=f"{SHOTS}/{name}-rules.png")
            ctx.close()
        br.close()
finally:
    srv.terminate()
real = [e for e in errors if "favicon" not in e]
ok(not real, f"no browser errors: {real[:3]}")
print(f"{passed} passed, {failed} failed")
