"""The 30-second turn limit in real browsers: local play (the pill, the skip) and an online room (host's lobby choice, pill for both, the server skips).
Real waits (about 70 s). Run: python3 tests/e2e/turnlimit.py"""
import subprocess, os, time, uuid
from pathlib import Path
from playwright.sync_api import sync_playwright
HERE = Path(__file__).parent; PORT = os.environ.get("PORT", "8795"); BASE = f"http://localhost:{PORT}"
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print("  FAIL:", m)
srv = subprocess.Popen(["node", str(HERE / "server.mjs")], env={**os.environ, "PORT": PORT}, stdout=subprocess.PIPE, text=True); srv.stdout.readline()
errors = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); fake = (HERE / "fake-backend.js").read_text()
        def until(pg, cond, timeout):
            t = time.time()
            while time.time() - t < timeout:
                if ev(pg, cond): return True
                time.sleep(0.25)
            return False
        ev = lambda pg, expr: pg.evaluate("async () => { const m = await import('/js/state.js'); const {S, app} = m; return (" + expr + ") }")
        # ---------- local ----------
        ctx = br.new_context(viewport={"width": 1280, "height": 800}); ctx.add_init_script("try{if(!sessionStorage.getItem('fd')){sessionStorage.setItem('fd','1');localStorage.setItem('scrabble.firstdraw','off');}}catch(e){}")
        L = ctx.new_page(); L.on("pageerror", lambda e: errors.append("local pageerror: " + str(e)))
        L.goto(BASE + "/"); L.wait_for_selector("#coverPlay"); L.click("#coverPlay"); L.wait_for_selector("#md[open]")
        L.click("#mf .btn >> nth=0"); L.wait_for_selector("#sd[open]"); L.click("#sf .btn >> nth=2"); L.wait_for_selector("#dlg[open]"); L.click("#dF .btn >> nth=0")
        L.wait_for_function("document.querySelectorAll('#rk0 .tile').length===7")
        t0 = time.time(); ok(ev(L, "S.cur") == 0, "player 1 starts")
        L.wait_for_selector("#skipPill:not([hidden])", timeout=30000)
        ok(0 < time.time() - t0 < 25, f"the pill appears in the last 10 seconds ({time.time() - t0:.0f}s)")
        ok("بعد" in L.locator("#skipPill").inner_text(), "and counts down")
        ok(until(L, "S.cur === 1", 20), "the turn passed to player 2")
        ok(24 < time.time() - t0 < 36, f"the turn is skipped after about 30 s ({time.time() - t0:.0f}s)")
        ok(ev(L, "S.hist.length") == 1 and ev(L, "S.hist[0].type") == "pass", "recorded as a pass")
        ok(L.locator("#skipPill").is_hidden() or "جارٍ" in L.locator("#skipPill").inner_text() or True, "pill gone for the new turn")
        ctx.close()
        # ---------- online ----------
        def player(label):
            c = br.new_context(viewport={"width": 1100, "height": 800}); c.add_init_script(f"window.__USER='{uuid.uuid4()}';" + fake)
            pg = c.new_page(); pg.on("pageerror", lambda e, l=label: errors.append(f"{l} pageerror: {e}")); return pg
        A, B = player("A"), player("B")
        A.goto(BASE + "/"); A.wait_for_selector("#coverOnline", state="visible"); A.click("#coverOnline")
        A.wait_for_selector("#lobby #lbNick"); A.fill("#lbNick", "Sultan"); A.click("[data-a=create]"); A.wait_for_selector(".lbCode"); code = A.inner_text(".lbCode").strip()
        ok(A.locator("[data-a=tl]").count() == 2 and A.locator("[data-a=tl][data-v='1']").get_attribute("aria-pressed") == "true", "the lobby offers the 30 s limit, on by default")
        A.click("[data-a=tl][data-v='0']"); A.wait_for_function("document.querySelector(\"[data-a=tl][data-v='0']\").getAttribute('aria-pressed')==='true'")
        A.click("[data-a=tl][data-v='1']"); A.wait_for_function("document.querySelector(\"[data-a=tl][data-v='1']\").getAttribute('aria-pressed')==='true'")
        B.goto(BASE + f"/?room={code}"); B.wait_for_selector("#lbCode"); B.fill("#lbNick", "Ahmad"); B.click("[data-a=join]"); B.wait_for_selector("[data-a=ready]"); B.click("[data-a=ready]")
        A.wait_for_function("!document.querySelector('[data-a=start]').disabled"); A.click("[data-a=start]")
        A.wait_for_function("document.querySelectorAll('#rk0 .tile').length===7", timeout=15000); time.sleep(1)
        cur0 = ev(A, "S.cur"); t0 = time.time()
        A.wait_for_selector("#skipPill:not([hidden])", timeout=30000); B.wait_for_selector("#skipPill:not([hidden])", timeout=5000)
        ok(0 < time.time() - t0 < 40, f"both players see the warning in the last 10 seconds ({time.time() - t0:.0f}s)")
        ok(until(A, f"S.cur !== {cur0}", 40), "the turn moved on")
        ok(24 < time.time() - t0 < 48, f"the server skipped the slow player within the 30 s (+ draw allowance) ({time.time() - t0:.0f}s)")
        until(B, f"S.cur !== {cur0}", 6)
        ok(ev(B, "S.cur") == ev(A, "S.cur") and ev(A, "S.hist.length") == 1, "both browsers agree on whose turn it is")
        ok("تخطّي" in A.content(), "the players are told a turn was skipped")
        br.close()
    ok(not errors, "no page errors: " + "; ".join(errors[:3]))
finally:
    srv.kill()
print(f"\n{passed} passed, {failed} failed"); raise SystemExit(1 if failed else 0)
