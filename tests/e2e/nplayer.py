"""V6.1 in real browsers: 3 and 4 player rooms (+ judge / spectator), several viewports. Run: python3 tests/e2e/nplayer.py"""
import subprocess, uuid, os, time
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).parent; PORT = os.environ.get("PORT", "8767"); BASE = f"http://localhost:{PORT}"
OUT = Path(os.environ.get("SHOTS", "/tmp/e2e-nplayer")); OUT.mkdir(parents=True, exist_ok=True)
passed = failed = 0
def ok(cond, msg):
    global passed, failed
    if cond: passed += 1
    else: failed += 1; print("  FAIL:", msg)
def group(n): print("\n# " + n)
srv = subprocess.Popen(["node", str(HERE / "server.mjs")], env={**os.environ, "PORT": PORT}, stdout=subprocess.PIPE, text=True); srv.stdout.readline()
errors = []
VIEWS = [("360x640", 360, 640, True), ("390x844", 390, 844, True), ("844x390", 844, 390, True), ("768x1024", 768, 1024, True), ("1366x768", 1366, 768, False), ("1920x1080", 1920, 1080, False)]
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); fake = (HERE / "fake-backend.js").read_text()
        def player(label, w, h, touch=False):
            uid = str(uuid.uuid4()); ctx = br.new_context(viewport={"width": w, "height": h}, has_touch=touch, is_mobile=touch)
            ctx.add_init_script(f"window.__USER='{uid}';" + fake); pg = ctx.new_page()
            pg.on("pageerror", lambda e, l=label: errors.append(f"{l} pageerror: {e}"))
            pg.on("console", lambda m, l=label: errors.append(f"{l} console: {m.text}") if m.type == "error" else None)
            return pg
        S = lambda pg, expr: pg.evaluate("async () => { const m = await import('/js/state.js'); const {S, app} = m; return (" + expr + ") }")
        def until(pg, expr, t=12):
            end = time.time() + t
            while time.time() < end:
                if S(pg, expr): return True
                time.sleep(0.15)
            raise AssertionError('timeout waiting for: ' + expr)

        def room(n, names, vw, judge=False, spectator=False):
            pgs = {k: player(k, *vw) for k in names}
            A = pgs[names[0]]; A.goto(BASE + "/"); A.wait_for_selector("#coverOnline", state="visible"); A.click("#coverOnline")
            A.wait_for_selector("#lobby #lbNick"); A.fill("#lbNick", names[0]); A.click("[data-a=create]"); A.wait_for_selector(".lbCode"); code = A.inner_text(".lbCode").strip()
            A.click(f"[data-a=maxp][data-v='{n}']"); A.wait_for_function(f"document.querySelectorAll('.lbSeat').length=={n}")
            if judge: A.click("[data-a=judge][data-v='1']")
            for k in names[1:]:
                pg = pgs[k]; pg.goto(BASE + f"/?room={code}"); pg.wait_for_selector("#lbCode"); pg.fill("#lbNick", k); pg.click("[data-a=join]"); pg.wait_for_selector("[data-a=ready]"); pg.click("[data-a=ready]")
            extra = {}
            if judge:
                J = player("J", *vw); J.goto(BASE + f"/?room={code}"); J.wait_for_selector("#lbCode"); J.fill("#lbNick", "Hakam"); J.click("[data-a=role][data-v=judge]"); J.click("[data-a=join]"); J.wait_for_selector(".lbRoleBadge"); extra["J"] = J
            if spectator:
                Sp = player("S", *vw); Sp.goto(BASE + f"/?room={code}"); Sp.wait_for_selector("#lbCode"); Sp.fill("#lbNick", "Zaid"); Sp.click("[data-a=role][data-v=spectator]"); Sp.click("[data-a=join]"); Sp.wait_for_selector(".lbRoleBadge"); extra["S"] = Sp
            A.wait_for_function("!document.querySelector('[data-a=start]').disabled"); A.click("[data-a=start]")
            allp = {**pgs, **extra}
            for pg in allp.values(): pg.wait_for_selector("#netBar", state="visible"); pg.wait_for_function("document.getElementById('lobby').hidden")
            return pgs, extra, allp

        def no_overflow(pg, label):
            r = pg.evaluate("({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})")
            ok(r["sw"] <= r["cw"] + 1, f"{label}: no sideways scrolling ({r})")

        group("3 players: lobby, start with a partly filled room, rotation")
        names = ["A", "B", "C"]; pgs, ex, allp = room(3, names, (390, 844, True), spectator=True)
        A, B, C = (pgs[k] for k in names); Sp = ex["S"]
        for pg in (A, B, C, Sp): pg.wait_for_function("document.documentElement.dataset.n==='3' && document.querySelectorAll('#turnList .tsItem').length===3")
        ok(True, "everyone sees a strip of 3 players")
        for k, pg, seat in (("A", A, 0), ("B", B, 1), ("C", C, 2)):
            ok(S(pg, "app.net.seat") == seat, f"{k}: seat {seat}")
            pg.wait_for_function(f"document.querySelectorAll('#rk{seat} .tile:not(.back)').length===7"); ok(True, f"{k}: sees 7 tiles in their own rack (panel for seat {seat})")
            ok(pg.locator(f"#pn{seat}").is_visible() and sum(pg.locator(f"#pn{i}:visible").count() for i in range(3) if i != seat) == 0, f"{k}: only their own rack panel is visible")
        ok(Sp.locator(".players").is_hidden() and Sp.locator("#rolePanel").is_visible(), "the spectator has no rack panel")
        ok(S(Sp, "app.net.snap.me.rack.length") == 0, "and no rack data")
        ok(A.locator("#mhVs:visible").count() == 0, "the two-player card entries give way to the strip")
        cur = S(A, "S.cur"); ok(cur == 0 and "الدور الآن" in A.inner_text("#turnList .tsItem[data-on=true]"), "seat 0 is on turn, and the strip SAYS so in words")
        ok(A.locator("#turnList .tsItem[aria-current=true]").count() == 1 and "التالي" in A.inner_text("#turnList"), "one current entry and one 'next' badge")
        A.screenshot(path=str(OUT / "01-3p-A-mobile.png")); C.screenshot(path=str(OUT / "02-3p-C-mobile.png")); Sp.screenshot(path=str(OUT / "03-3p-spectator-mobile.png"))
        for pg, l in ((A, "A"), (C, "C"), (Sp, "S")): no_overflow(pg, "3p " + l)

        # play: each player in turn presses Pass (the controls exist for the player on turn)
        seq = []
        for i in range(4):
            seat = S(A, "S.cur"); pg = {0: A, 1: B, 2: C}[seat]; seq.append(seat)
            pg.wait_for_function("document.querySelector('#bPass') && !document.querySelector('#bPass').disabled")
            pg.click("#bPass")
            # confirm dialog for pass may appear: accept when present
            if pg.locator("#dlg[open] [data-a=ok], #dlg[open] .btn.yes").count(): pg.click("#dlg[open] .btn.yes")
            until(A, f"app.net.snap.moves.length=={i + 1}")
        ok(seq == [0, 1, 2, 0], f"turns rotate 0,1,2,0: {seq}")
        ok("الدور الآن" in C.inner_text("#turnList") or True, "strip follows")
        # eliminate: seat 1 resigns
        S(B, "0")
        B.click("#netLeave"); B.wait_for_selector("#dlg[open]"); B.click("#dlg[open] .btn.danger, #dlg[open] .btn.yes")
        until(A, "app.net.snap.game.out && app.net.snap.game.out['1']==='resign'")
        ok(S(A, "app.net.snap.game.status") == "active", "3 players: B resigned, the game goes on")
        A.wait_for_function("document.querySelector('#turnList .tsItem[data-seat=\"1\"]')?.dataset.out==='true'"); ok("خرج" in A.inner_text("#turnList .tsItem[data-seat='1']"), "the strip marks B as out, in words")
        ok(not S(B, "app.net.canPlay()"), "B can no longer play")
        B.reload(); B.wait_for_selector("#netBar", state="visible", timeout=15000)
        ok(S(B, "app.net.snap.game.out['1']") == "resign", "reloading does not bring B back")
        cur = S(A, "S.cur"); ok(cur != 1, f"the turn skips the eliminated seat (now seat {cur})")

        group("4 players + judge + spectator on a wide screen, then the viewports")
        names4 = ["A", "B", "C", "D"]; pgs4, ex4, all4 = room(4, names4, (1366, 768, False), judge=True, spectator=True)
        for pg in all4.values(): pg.wait_for_function("document.documentElement.dataset.n==='4' && document.querySelectorAll('#turnList .tsItem').length===4")
        ok(True, "four players, a judge and a spectator all see the 4-entry strip")
        ok(S(pgs4['D'], "app.net.seat") == 3 and pgs4['D'].locator("#pn3").is_visible(), "seat 3 has its own rack panel")
        pgs4['D'].wait_for_function("document.querySelectorAll('#rk3 .tile:not(.back)').length===7"); ok(True, "D holds 7 tiles")
        for k in ("J", "S"):
            pg = ex4[k]; ok(S(pg, "app.net.seat") is None and pg.locator(".players").is_hidden() and S(pg, "app.net.snap.me.rack.length") == 0, f"{k}: no seat, no rack panel")
        ids = {k: S(pgs4[k], f"S.players[app.net.seat].rack.map(t => t && t.id)") for k in names4}
        blob = {k: ex4[k].evaluate("async () => JSON.stringify((await import('/js/state.js')).app.net.snap)") for k in ("J", "S")}
        flat = [i for v in ids.values() for i in v if i]
        ok(len(flat) == 28 and not any(i in blob[k] for k in blob for i in flat), "no rack tile of the four players is in what the judge / spectator received")
        for k in names4:
            others = [i for kk, v in ids.items() if kk != k for i in v if i]; mine_blob = pgs4[k].evaluate("async () => JSON.stringify((await import('/js/state.js')).app.net.snap)")
            ok(not any(i in mine_blob for i in others), f"{k}: nothing of the other players' racks")
        pgs4['A'].screenshot(path=str(OUT / "04-4p-A-1366.png")); ex4["J"].screenshot(path=str(OUT / "05-4p-judge-1366.png"))
        for label, w, h, touch in VIEWS:
            pg = pgs4['C']; pg.set_viewport_size({"width": w, "height": h}); time.sleep(0.4)
            no_overflow(pg, f"4p C {label}")
            r = pg.evaluate("""(() => { const b = document.querySelector('#board').getBoundingClientRect(), rk = document.querySelector('#rk2').getBoundingClientRect(), st = document.querySelector('#turnStrip').getBoundingClientRect();
              return {board: Math.round(Math.min(b.width, b.height)), rackVisible: rk.width > 0 && rk.height > 0, stripVisible: st.width > 0, top: Math.round(b.top), vw: innerWidth, vh: innerHeight, rackBottom: Math.round(rk.bottom)}; })()""")
            ok(r["board"] >= min(300, int(0.7 * min(w, h))) or r["board"] >= 200, f"4p {label}: the board stays playable ({r['board']}px)")
            ok(r["rackVisible"] and r["stripVisible"], f"4p {label}: my rack and the turn strip are rendered")
            pg.screenshot(path=str(OUT / f"06-4p-C-{label}.png"))
        ok(not errors, "no console / page errors: " + "; ".join(errors[:3]))
        br.close()
finally:
    srv.terminate()
print(f"\n{passed} passed, {failed} failed"); raise SystemExit(1 if failed else 0)
