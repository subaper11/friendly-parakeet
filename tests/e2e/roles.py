"""V6.0 roles in real browsers: host, guest, JUDGE and SPECTATOR through the real server core (see server.mjs). Run: python3 tests/e2e/roles.py"""
import subprocess, time, uuid, os
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).parent; PORT = os.environ.get("PORT", "8766"); BASE = f"http://localhost:{PORT}"
OUT = Path(os.environ.get("SHOTS", "/tmp/e2e-roles")); OUT.mkdir(parents=True, exist_ok=True)
passed = failed = 0
def ok(cond, msg):
    global passed, failed
    if cond: passed += 1
    else: failed += 1; print("  FAIL:", msg)
def group(n): print("\n# " + n)

srv = subprocess.Popen(["node", str(HERE / "server.mjs")], env={**os.environ, "PORT": PORT}, stdout=subprocess.PIPE, text=True)
srv.stdout.readline()
errors = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); fake = (HERE / "fake-backend.js").read_text()
        def player(label, w, h, touch=False):
            uid = str(uuid.uuid4()); ctx = br.new_context(viewport={"width": w, "height": h}, has_touch=touch, is_mobile=touch)
            ctx.add_init_script(f"window.__USER='{uid}';" + fake); pg = ctx.new_page()
            pg.on("pageerror", lambda e, l=label: errors.append(f"{l} pageerror: {e}"))
            pg.on("console", lambda m, l=label: errors.append(f"{l} console: {m.text}") if m.type == "error" else None)
            return pg
        A = player("A", 1280, 800); B = player("B", 390, 844, touch=True); J = player("J", 1280, 800); Sp = player("S", 390, 844, touch=True)
        S = lambda pg, expr: pg.evaluate("async () => { const m = await import('/js/state.js'); const {S, app} = m; return (" + expr + ") }")
        txt = lambda pg, sel: (pg.inner_text(sel) if pg.locator(sel).count() else "")

        group("lobby: host turns the judge on, a judge and a spectator join with their own role")
        A.goto(BASE + "/"); A.wait_for_selector("#coverOnline", state="visible"); A.click("#coverOnline")
        A.wait_for_selector("#lobby #lbNick"); A.fill("#lbNick", "Sultan"); A.click("[data-a=create]")
        A.wait_for_selector(".lbCode"); code = A.inner_text(".lbCode").strip()
        ok(A.locator(".lbSeat").count() == 2 and A.locator(".lbExtra.judge").count() == 0, "a room without a judge shows no judge slot")
        A.click("[data-a=judge][data-v='1']"); A.wait_for_selector(".lbExtra.judge.empty")
        ok(A.locator(".lbExtra.spec").inner_text().count("0 / 10") == 1, "spectator capacity 0 / 10 shown")
        ok("لاعب" in A.inner_text(".lbRoleBadge"), "the host's role is shown: player")
        B.goto(BASE + f"/?room={code}"); B.wait_for_selector("#lbCode"); B.fill("#lbNick", "Ahmad"); B.click("[data-a=join]"); B.wait_for_selector("[data-a=ready]")
        J.goto(BASE + f"/?room={code}"); J.wait_for_selector("#lbCode"); J.fill("#lbNick", "Hakam")
        ok(J.locator("[data-a=role][aria-pressed=true]").count() == 1 and J.locator("[data-a=role][data-v=player][aria-pressed=true]").count() == 1, "the join form asks for a role (player preselected)")
        J.click("[data-a=role][data-v=judge]"); J.click("[data-a=join]"); J.wait_for_selector(".lbRoleBadge")
        ok("حَكَم" in J.inner_text(".lbRoleBadge") and J.locator("[data-a=ready]").count() == 0 and J.locator("[data-a=start]").count() == 0, "the judge is told their role and has no ready / start button")
        Sp.goto(BASE + f"/?room={code}"); Sp.wait_for_selector("#lbCode"); Sp.fill("#lbNick", "Zaid"); Sp.click("[data-a=role][data-v=spectator]"); Sp.click("[data-a=join]"); Sp.wait_for_selector(".lbRoleBadge")
        ok("متفرّج" in Sp.inner_text(".lbRoleBadge") and Sp.locator("[data-a=ready]").count() == 0, "the spectator is told their role")
        A.wait_for_function("document.querySelector('.lbExtra.judge')?.textContent.includes('Hakam') && document.querySelector('.lbExtra.spec')?.textContent.includes('1 / 10')")
        ok(A.locator(".lbSeat").count() == 2, "still two player seats; the judge and spectator are not seats")
        A.screenshot(path=str(OUT / "01-lobby-host.png")); Sp.screenshot(path=str(OUT / "02-lobby-spectator-mobile.png"))
        B.click("[data-a=ready]"); A.wait_for_function("!document.querySelector('[data-a=start]').disabled"); A.click("[data-a=start]")
        for pg in (A, B, J, Sp): pg.wait_for_selector("#netBar", state="visible"); pg.wait_for_function("document.getElementById('lobby').hidden")

        group("the match: judge and spectator watch, with no rack and no controls")
        A.wait_for_function("document.querySelectorAll('#rk0 .tile:not(.back)').length===7"); B.wait_for_function("document.querySelectorAll('#rk1 .tile:not(.back)').length===7")
        for n, pg in (("judge", J), ("spectator", Sp)):
            pg.wait_for_function("document.getElementById('cover').hidden")
            ok(S(pg, "app.net.role") == n.replace("judge", "judge"), f"{n}: role in the session")
            ok(pg.evaluate("document.documentElement.dataset.role") == n, f"{n}: html[data-role]")
            ok(S(pg, "app.net.snap.me.rack.length") == 0 and S(pg, "app.net.seat") is None, f"{n}: no rack, no seat")
            ids = [t for t in (S(A, "S.players[0].rack.map(t => t && t.id)") + S(B, "S.players[1].rack.map(t => t && t.id)")) if t]
            blob = pg.evaluate("async () => JSON.stringify((await import('/js/state.js')).app.net.snap)")
            ok(len(ids) == 14 and not any(i in blob for i in ids), f"{n}: none of the 14 rack tile ids is anywhere in the received state")
            ok(pg.locator("#rk0 .tile").count() == 0 and pg.locator("#rk1 .tile").count() == 0, f"{n}: no tiles drawn in any rack")
            ok(pg.locator(".players").is_hidden() and pg.locator("#bSubmit").is_hidden() and pg.locator("#bPass").is_hidden() and pg.locator("#bSwap").is_hidden(), f"{n}: player panels and turn buttons are removed")
            ok(pg.locator("#rolePanel").is_visible(), f"{n}: the role panel is shown")
        ok(Sp.locator("#netPause").is_hidden(), "the spectator has no pause button")
        ok(Sp.locator("#netRematch").is_hidden() and "متفرّج" in Sp.inner_text("#rolePanel"), "the spectator banner says watch only")
        ok("الحكم" in J.inner_text("#rolePanel") and J.locator("[data-rp=open]").count() == 1 and J.locator("[data-rp=open]").is_disabled(), "the judge's panel offers Open Tahkim, disabled until there is a move")
        ok(B.locator("#rolePanel").is_visible() and "Hakam" in B.inner_text("#rolePanel"), "a player sees that a judge is here")
        ok(B.locator("#bJudge .lbl").inner_text().startswith("استدعاء الحكم"), "the dispute button now reads 'call the judge'")
        J.screenshot(path=str(OUT / "03-match-judge.png")); Sp.screenshot(path=str(OUT / "04-match-spectator-mobile.png"))

        def play_two(pg, seat):
            blanks = S(pg, f"S.players[{seat}].rack.map(t => !!(t && t.blank))"); idx = [i for i, b in enumerate(blanks) if not b][:2]
            for k, i in enumerate(idx): pg.click(f"#rk{seat} .slot:nth-child({i + 1}) .tile"); pg.click(f"#board > .sq:nth-child({7 * 15 + 7 + k + 1})")
        play_two(A, 0); A.click("#bSubmit")
        for pg in (B, J, Sp): pg.wait_for_function("document.querySelectorAll('#board .sq.has').length===2")
        ok(True, "everyone, judge and spectator included, sees A's move")
        ok(not J.locator("#board .sq.mv").count() and S(Sp, "app.net.canPlay()") is False, "the spectator cannot play")

        group("Ping Judge: the clock stops, the judge is told")
        J.wait_for_function("!document.querySelector('[data-rp=open]').disabled")
        ok(True, "the judge can now open a Tahkim on their own initiative")
        B.click("#bJudge"); B.wait_for_selector("#tkReason"); ok("استدعاء الحكم" in B.inner_text("#jT"), "the call dialog opens (not the consensus Tahkim)")
        B.fill("#tkReason", "كلمة غير صحيحة"); B.click("[data-a=ping]")
        J.wait_for_function("document.querySelector('#rolePanel .rpCall')"); ok("كلمة غير صحيحة" in J.inner_text("#rolePanel .rpCall") and "Ahmad" in J.inner_text("#rolePanel .rpCall"), "the judge sees who called, which move and why")
        for n, pg in (("A", A), ("B", B), ("S", Sp)): pg.wait_for_function("app_ping()".replace("app_ping()", "true") if False else "document.getElementById('netState').textContent.includes('الحكم')"); ok(S(pg, "app.net.snap.game.clock_running") is False, f"{n}: the clock is stopped")
        ok(B.locator("#bPass").is_disabled() and B.locator("#bSubmit").is_disabled(), "the caller cannot play while waiting for the judge")
        ok(B.locator("[data-rp=cancel]").count() == 1, "the caller has a 'withdraw the call' button")
        ok(B.locator("#bJudge").is_disabled() or "(2)" in B.locator("#bJudge .lbl").inner_text(), "the quota shows 2 left")

        group("the judge opens the Tahkim and rules: players only talk")
        J.click("[data-rp=open]")
        for n, pg in (("A", A), ("B", B), ("J", J)): pg.wait_for_selector("#tkPanel", state="visible"); ok(True, f"{n}: the Tahkim window opened")
        ok(Sp.locator("#tkPanel").count() == 0 or Sp.locator("#tkPanel").is_hidden(), "the spectator gets no Tahkim window")
        ok(B.locator(".tkPick").first.is_hidden() and B.locator("#tkConfirm").is_hidden(), "players under a judge have no verdict buttons")
        ok(J.locator(".tkPick").first.is_visible(), "the judge has the verdict buttons")
        B.fill("#tkText", "فيها ضمير متصل"); B.click("#tkSend"); J.wait_for_function("document.querySelectorAll('#tkLog .tkMsg').length>=1")
        J.fill("#tkText", "سأنظر في الأمر"); J.click("#tkSend"); A.wait_for_function("document.querySelectorAll('#tkLog .tkMsg').length>=2")
        ok(A.locator("#tkLog .tkMsg.judge").count() == 1, "the judge's line is marked")
        J.screenshot(path=str(OUT / "05-tahkim-judge.png")); B.screenshot(path=str(OUT / "06-tahkim-player-mobile.png"))
        J.click(".tkPick[data-v=invalid]"); J.click("#tkConfirm")
        for pg in (A, B, J): pg.wait_for_selector("#tkPanel", state="hidden")
        ok(True, "the ruling closes the window everywhere")
        for pg in (A, B, J, Sp): pg.wait_for_function("document.querySelectorAll('#board .sq.has').length===0")
        ok(S(B, "app.net.snap.game.current_seat") == 1 and S(A, "app.net.snap.game.tahkim.state") == "resolved_invalid", "the move was voided and B is on turn")
        ok(A.locator("#rk0 .tile:not(.back)").count() == 7, "A has their 7 tiles back")

        group("withdraw a call; judge pause")
        play_two(B, 1); B.click("#bSubmit"); A.wait_for_function("document.querySelectorAll('#board .sq.has').length===2")
        A.click("#bJudge"); A.wait_for_selector("#tkReason"); A.click("[data-a=ping]"); A.wait_for_selector("[data-rp=cancel]")
        A.click("[data-rp=cancel]"); A.wait_for_function("document.querySelector('[data-rp=cancel]')===null")
        J.wait_for_function("!document.querySelector('#rolePanel .rpCall')"); ok(S(A, "app.net.snap.game.clock_running") is True, "the call was withdrawn: the clock runs again")
        J.click("#netPause"); 
        for n, pg in (("A", A), ("B", B), ("S", Sp)): pg.wait_for_selector("#mOv:not([hidden])"); ok("الحكم" in pg.inner_text("#mOvT"), f"{n}: the judge's pause card")
        ok(A.locator("#mOvAct button").first.is_disabled(), "a player cannot resume while the judge is here")
        ok(Sp.locator("#mOvAct button").count() == 0, "the spectator has no buttons on the pause card")
        J.wait_for_selector("#mOv:not([hidden])"); ok("استئناف" in J.inner_text("#mOvAct"), "the judge's own pause card carries the resume button")
        J.click("#mOvAct button")
        for pg in (A, B, Sp): pg.wait_for_selector("#mOv", state="hidden")
        ok(True, "the judge resumed it")

        group("a spectator leaves: nobody's game changes")
        rev = S(A, "app.net.snap.game.revision")
        Sp.click("#netLeave"); A.wait_for_function("app_count()".replace("app_count()", "true") if False else "document.getElementById('rolePanel') && true")
        time.sleep(1.2)
        ok(S(A, "app.net.snap.spectator_count") == 0 and S(A, "app.net.snap.game.revision") == rev, "the spectator count dropped, the revision did not move")
        ok(not errors, "no console errors / page errors: " + "; ".join(errors[:3]))
        br.close()
finally:
    srv.terminate()
print(f"\n{passed} passed, {failed} failed"); raise SystemExit(1 if failed else 0)
