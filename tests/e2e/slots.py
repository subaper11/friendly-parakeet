"""Lobby as slots in real browsers: free choice of seat / role. Run: python3 tests/e2e/slots.py"""
import subprocess, uuid, os, time
from pathlib import Path
from playwright.sync_api import sync_playwright
HERE = Path(__file__).parent; PORT = os.environ.get("PORT", "8770"); BASE = f"http://localhost:{PORT}"
OUT = Path("/tmp/e2e-slots"); OUT.mkdir(exist_ok=True)
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print("  FAIL:", m)
srv = subprocess.Popen(["node", str(HERE / "server.mjs")], env={**os.environ, "PORT": PORT}, stdout=subprocess.PIPE, text=True); srv.stdout.readline()
import urllib.request; urllib.request.urlopen(BASE + '/__draw?on=1').read()   # the real start: the turn order and the first player are DRAWN
errors = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); fake = (HERE / "fake-backend.js").read_text()
        def player(label, w=1280, h=800, touch=False):
            uid = str(uuid.uuid4()); ctx = br.new_context(viewport={"width": w, "height": h}, has_touch=touch, is_mobile=touch); ctx.add_init_script(f"window.__USER='{uid}';" + fake)
            pg = ctx.new_page(); pg.on("pageerror", lambda e, l=label: errors.append(f"{l}: {e}")); return pg
        S = lambda pg, expr: pg.evaluate("async () => { const m = await import('/js/state.js'); const {S, app} = m; return (" + expr + ") }")
        A, B, C, D = player("A"), player("B", 390, 844, True), player("C"), player("D")
        A.goto(BASE + "/"); A.click("#coverOnline"); A.wait_for_selector("#lbNick"); A.fill("#lbNick", "Sultan"); A.click("[data-a=create]"); A.wait_for_selector(".lbCode"); code = A.inner_text(".lbCode").strip()
        A.click("[data-a=maxp][data-v='4']"); A.click("[data-a=judge][data-v='1']"); A.wait_for_function("document.querySelectorAll('.lbSeat').length===4")
        ok(A.locator(".lbSlots > .lbSeat").count() == 4 and A.locator(".lbSlots > .lbSeat.empty").count() == 3, "four slot cards in one list, three of them empty")
        ok(A.locator(".lbSeat.empty button[data-a=slot]").count() == 3, "every empty slot is a button")
        ok("VS" not in A.inner_text(".lobby, #lobby") and A.locator("#lobby .vs, #lobby .lbVs").count() == 0, "no VS element (a single row of slots)")
        tops = A.evaluate("[...document.querySelectorAll('.lbSlots > .lbSeat')].map(e => Math.round(e.getBoundingClientRect().top))"); ok(len(set(tops)) == 1, f"the four cards sit in one row on a wide screen: {tops}")
        B.goto(BASE + f"/?room={code}"); B.wait_for_selector("#lbCode"); B.fill("#lbNick", "Ahmad"); B.click("[data-a=join]"); B.wait_for_selector("[data-a=ready]")
        ok(B.locator(".lbSeat.me").count() == 1 and S(B, "app.net.snap.me.seat") == 1, "a joiner takes the lowest free seat (2)")
        B.click(".lbSeat.empty[data-slot='3'] button"); B.wait_for_function("document.querySelector('.lbSeat.me')?.dataset.slot==='3'")
        ok(True, "B moves to slot 4 by tapping it"); A.wait_for_function("document.querySelector('.lbSeat[data-slot=\"3\"] .lbWho')?.textContent.includes('Ahmad')"); ok(True, "the host sees B in slot 4 at once")
        ok(A.locator(".lbSeat[data-slot='1'].empty").count() == 1, "slot 2 is free again")
        B.click("[data-a=ready]"); A.wait_for_function("!document.querySelector('[data-a=start]').disabled")
        C.goto(BASE + f"/?room={code}"); C.wait_for_selector("#lbCode"); C.fill("#lbNick", "Zaid"); C.click("[data-a=role][data-v=spectator]"); C.click("[data-a=join]"); C.wait_for_selector(".lbRoleBadge")
        A.wait_for_function("document.querySelector('.lbExtra.spec')?.textContent.includes('Zaid')"); ok(True, "the gallery row lists the spectator by name")
        C.click(".lbExtra.judge .lbTake"); C.wait_for_function("document.querySelector('.lbRoleBadge')?.textContent.includes('حَكَم')"); ok(True, "C moves from the gallery to the judge chair")
        A.wait_for_function("document.querySelector('.lbExtra.judge')?.textContent.includes('Zaid')"); ok(A.locator(".lbExtra.spec").inner_text().count("0 /") == 1, "the gallery is empty again, the judge chair shows C")
        ok(A.locator(".lbExtra.spec .lbTake").is_disabled(), "the host's 'watch' button is disabled (the host keeps a seat)")
        D.goto(BASE + f"/?room={code}"); D.wait_for_selector("#lbCode"); D.fill("#lbNick", "Dina"); D.click("[data-a=join]"); D.wait_for_selector("[data-a=ready]"); D.click("[data-a=ready]")
        A.wait_for_function("document.querySelectorAll('.lbSeat:not(.empty)').length===3")
        for pg in (A, B): pg.evaluate("document.querySelector('.lbRoleBadge').scrollIntoView({block:'start'})")
        A.screenshot(path=str(OUT / "lobby-host-1280.png")); B.screenshot(path=str(OUT / "lobby-guest-mobile.png"))
        A.wait_for_function("!document.querySelector('[data-a=start]').disabled"); A.click("[data-a=start]")
        for pg in (A, B, C, D): pg.wait_for_selector("#netBar", state="visible"); pg.wait_for_function("document.getElementById('lobby').hidden")
        seats = sorted(S(A, "app.net.snap.players.map(p => p.seat)")); ok(seats == [0, 1, 2], f"the gaps were closed at the start: seats {seats}")
        order = S(A, "app.net.snap.game.order"); ok(order and sorted(order) == [0, 1, 2], f"a turn order was drawn: {order}")
        A.wait_for_function("document.querySelectorAll('#turnList .tsItem').length===3")
        names = A.evaluate("[...document.querySelectorAll('#turnList .tsItem .tsName')].map(e => e.textContent.replace(' (أنت)',''))"); expected = [S(A, f"app.net.snap.players.find(p => p.seat===({s})).nickname") for s in order]
        ok(names == expected, f"the strip lists players in the DRAWN order: {names}")
        ok(not errors, "no page errors: " + "; ".join(errors[:3]))
        br.close()
finally: srv.terminate()
print(f"\n{passed} passed, {failed} failed"); raise SystemExit(1 if failed else 0)
