"""Online rooms judged automatically, in two real browsers through the real server core: the host's choice (automatic vs Tahkim) in the lobby, Judge and Tahkim
gone in an automatic room, a clearly unknown word refused with its tiles kept, a real word accepted. Run: python3 tests/e2e/autowords.py"""
import subprocess, os, time, uuid
from pathlib import Path
from playwright.sync_api import sync_playwright
HERE = Path(__file__).parent; PORT = os.environ.get("PORT", "8793"); BASE = f"http://localhost:{PORT}"
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
        def player(label, w=1100, h=800):
            ctx = br.new_context(viewport={"width": w, "height": h}); ctx.add_init_script(f"window.__USER='{uuid.uuid4()}';" + fake)
            pg = ctx.new_page(); pg.on("pageerror", lambda e, l=label: errors.append(f"{l} pageerror: {e}"))
            pg.on("console", lambda m, l=label: errors.append(f"{l} console: {m.text}") if m.type == "error" else None); return pg
        A, B = player("A"), player("B")
        ev = lambda pg, expr: pg.evaluate("async () => { const m = await import('/js/state.js'); const {S, app} = m; return (" + expr + ") }")
        A.goto(BASE + "/"); A.wait_for_selector("#coverOnline", state="visible"); A.click("#coverOnline")
        A.wait_for_selector("#lobby #lbNick"); A.fill("#lbNick", "Sultan"); A.click("[data-a=create]"); A.wait_for_selector(".lbCode")
        code = A.inner_text(".lbCode").strip()
        ok(A.locator("[data-a=wj]").count() == 2, "the lobby offers exactly two ways to judge words")
        ok(A.locator("[data-a=wj][data-v=tahkim]").get_attribute("aria-pressed") == "true", "Tahkim is the default")
        ok(A.locator("[data-a=judge]").count() == 2, "in a Tahkim room the Judge option exists")
        A.click("[data-a=wj][data-v=auto]"); A.wait_for_function("document.querySelector('[data-a=wj][data-v=auto]').getAttribute('aria-pressed')==='true'")
        ok(A.locator("[data-a=judge]").count() == 0, "choosing automatic removes the Judge option entirely")
        ok(A.locator(".lbExtra.judge").count() == 0, "and the Judge seat")
        A.click("[data-a=wj][data-v=tahkim]"); A.wait_for_selector("[data-a=judge]")
        ok(True, "going back to Tahkim brings the Judge option back")
        A.click("[data-a=wj][data-v=auto]"); A.wait_for_function("document.querySelector('[data-a=wj][data-v=auto]').getAttribute('aria-pressed')==='true'")
        B.goto(BASE + f"/?room={code}"); B.wait_for_selector("#lbCode"); B.fill("#lbNick", "Ahmad"); B.click("[data-a=join]"); B.wait_for_selector("[data-a=ready]")
        ok(B.locator("[data-a=wj][data-v=auto]").get_attribute("aria-pressed") == "true" and B.locator("[data-a=wj]").first.is_disabled(), "the guest sees the choice but cannot change it")
        B.click("[data-a=ready]"); A.wait_for_function("!document.querySelector('[data-a=start]').disabled"); A.click("[data-a=start]")
        A.wait_for_function("document.querySelectorAll('#rk0 .tile').length===7", timeout=15000); B.wait_for_function("document.querySelectorAll('#rk1 .tile').length===7 || document.querySelectorAll('#rk0 .tile').length===7", timeout=15000)
        time.sleep(0.5)
        ok(A.locator("#bJudge").is_hidden() and B.locator("#bJudge").is_hidden(), "no Tahkim button for either player")
        # find a pair of tiles the dictionary calls unknown, and one it accepts
        pairs = A.evaluate("""async () => { const {S} = await import('/js/state.js'); const {createDictionary} = await import('/js/dictionary.js');
          const D = createDictionary(new Uint8Array(await (await fetch('/data/words.bin')).arrayBuffer()), new Uint8Array(await (await fetch('/data/common-words.bin')).arrayBuffer())); const me = S.players.findIndex(p => p.rack.some(t => t && !t.hidden));
          const r = S.players[me].rack.map((t, i) => t && !t.blank ? [t.l, i] : null).filter(Boolean); const bad = [], good = [];
          for (const [a, i] of r) for (const [b, j] of r) if (i !== j) { const res = D.check(a + b, {mode: 'expanded'}); (res.ok ? good : bad).push([i, j, a + b]); }
          return {bad: bad[0] || null, good: good[0] || null, me}; }""")
        me = pairs["me"]
        def put(i, j):
            A.click(f"#rk{me} .slot:nth-child({i + 1}) .tile"); A.click(f"#board > .sq:nth-child({7 * 15 + 7 + 1})")
            A.click(f"#rk{me} .slot:nth-child({j + 1}) .tile"); A.click(f"#board > .sq:nth-child({7 * 15 + 8 + 1})"); A.click("#bSubmit")
        if pairs["bad"]:
            i, j, w = pairs["bad"]; put(i, j); time.sleep(1.2)
            ok(ev(A, "S.hist.length") == 0 and ev(A, "S.cur") == me, f"an unknown word ({w}) is refused: the move is not played")
            ok("القاموس" in A.locator("#toast").inner_text() or "القاموس" in A.content(), "the player is told the dictionary does not know it")
            A.click("#bCancel"); time.sleep(0.3)
        else: print("  (note: every pair was accepted)")
        if pairs["good"]:
            i, j, w = pairs["good"]; put(i, j); A.wait_for_function("document.getElementById('sc%d').textContent!=='0'" % me, timeout=10000)
            ok(ev(A, "S.hist.length") == 1, f"a real word ({w}) is accepted and scored")
        ok(A.locator("#bJudge").is_hidden(), "still no Tahkim after a move")
        br.close()
    ok(not errors, "no console / page errors: " + "; ".join(errors[:3]))
finally:
    srv.kill()
print(f"\n{passed} passed, {failed} failed"); raise SystemExit(1 if failed else 0)
