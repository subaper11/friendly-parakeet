"""Play against the computer, in a real browser: cover door -> level -> mode -> duration -> the computer answers with real moves, the dictionary judges the human's words,
no Tahkim / Undo, saved-match round trip. Run: python3 tests/e2e/bot.py"""
import subprocess, os, time
from pathlib import Path
from playwright.sync_api import sync_playwright
HERE = Path(__file__).parent; PORT = os.environ.get("PORT", "8791"); BASE = f"http://localhost:{PORT}"
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print("  FAIL:", m)
srv = subprocess.Popen(["node", str(HERE / "server.mjs")], env={**os.environ, "PORT": PORT}, stdout=subprocess.PIPE, text=True); srv.stdout.readline()
errors = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1280, "height": 800})
        ctx.add_init_script("try{if(!sessionStorage.getItem('fd')){sessionStorage.setItem('fd','1');localStorage.setItem('scrabble.firstdraw','off');}}catch(e){}")
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e))); pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        ev = lambda expr: pg.evaluate("async () => { const m = await import('/js/state.js'); const {S, app} = m; return (" + expr + ") }")
        pg.goto(BASE + "/"); pg.wait_for_selector("#coverBot")
        ok(pg.locator("#coverBot").is_visible(), "the cover offers a third door: VS COMPUTER")
        pg.click("#coverBot"); pg.wait_for_selector("#blv[open]")
        ok(pg.locator("#blf .btn").count() == 3, "three levels are offered")
        pg.click("#blf .btn >> nth=0")   # easy: the shortest think time
        pg.wait_for_selector("#md[open]", timeout=20000)
        ok(pg.evaluate("async () => { const m = await import('/js/bot.js'); return true }"), "bot module loads")
        pg.click("#mf .btn >> nth=0"); pg.wait_for_selector("#sd[open]"); pg.click("#sf .btn >> nth=2")
        pg.wait_for_selector("#dlg[open]"); pg.click("#dF .btn >> nth=0")
        pg.wait_for_function("document.querySelectorAll('#rk0 .tile').length===7")
        ok(ev("app.bot && app.bot.level") == "easy", "the game runs against the computer (easy)")
        ok("الحاسوب" in pg.locator("#pn1").inner_text(), "player 2 is shown as the computer")
        ok(pg.locator("#bJudge").is_hidden(), "no challenge button against the computer")
        ok(pg.locator("#bUndo").is_disabled(), "no Undo against the computer")
        ok(pg.locator("#rk1 .tile.back").count() == 7 and pg.locator("#rk1 .tile:not(.back)").count() == 0, "the computer's rack is face down")

        # a human move the dictionary refuses stays on the board for correction and scores nothing
        pair = pg.evaluate("""async () => { const {S, app} = await import('/js/state.js'); const {tileLetter} = await import('/js/modes.js');
          const r = S.players[0].rack.map((t, i) => t && !t.blank ? [t, i] : null).filter(Boolean);
          for (const [a, i] of r) for (const [b, j] of r) if (a !== b) { const w = [[{t:a},{t:b}]]; if (app.checkWords(w)) return [i, j, app.checkWords(w)]; }
          return null; }""")
        if pair:
            i, j, msg = pair
            pg.click(f"#rk0 .slot:nth-child({i + 1}) .tile"); pg.click(f"#board > .sq:nth-child({7 * 15 + 7 + 1})")
            pg.click(f"#rk0 .slot:nth-child({j + 1}) .tile"); pg.click(f"#board > .sq:nth-child({7 * 15 + 8 + 1})")
            pg.click("#bSubmit"); time.sleep(0.4)
            ok(ev("S.hist.length") == 0 and ev("S.move.length") == 2 and ev("S.cur") == 0, "an unknown word is refused: nothing scored, the tiles stay for correction (" + msg[:40] + ")")
            pg.click("#bCancel")
        else:
            print("  (note: every pair of the first rack happened to be accepted)")
        ok(ev("S.move.length") == 0, "the board is clear again")

        # the computer answers: three rounds of (human passes, computer plays)
        for rnd in range(3):
            n = ev("S.hist.length"); pg.click("#bPass")
            pg.wait_for_function(f"(() => {{ const el = document.getElementById('sc1'); return true; }})()")
            pg.wait_for_function("async () => true")
            t0 = time.time()
            while ev("S.hist.length") < n + 2 and time.time() - t0 < 25: time.sleep(0.3)
            ok(ev("S.hist.length") >= n + 2 and ev("S.cur") == 0, f"round {rnd + 1}: the computer took its turn within 25 s ({time.time() - t0:.1f}s)")
        h = ev("S.hist.filter(e => e.p === 1)")
        moves = [e for e in h if e["type"] == "move"]
        ok(len(moves) >= 1 and all(e["total"] > 0 and e["words"] for e in moves), f"the computer played {len(moves)} real move(s) with scored words")
        ok(int(pg.locator("#sc1").inner_text()) == sum(e["total"] for e in moves), "its score on the panel is the sum of its moves")
        # every word it played passes the strict dictionary reading
        bad = pg.evaluate("""async () => { const {S, app} = await import('/js/state.js'); const r = await fetch('/data/words.bin'); const c = await fetch('/data/common-words.bin'); const {createDictionary} = await import('/js/dictionary.js');
          const D = createDictionary(new Uint8Array(await r.arrayBuffer()), new Uint8Array(await c.arrayBuffer())); return S.hist.filter(e => e.p === 1 && e.type === 'move').flatMap(e => e.words.map(w => w.w)).filter(w => !D.check(w, {mode: app.mode}).ok); }""")
        ok(not bad, "every word the computer played is a dictionary word: " + str(bad))
        ok(pg.evaluate("async () => { const P = await import('/js/persist.js'); const d = JSON.parse(JSON.stringify(P.serialise())); return P.validate(d) && d.bot && d.bot.level === 'easy'; }"), "the saved match validates and remembers the computer")

        # reload: the cover's PLAY offers the saved match and it resumes against the computer
        time.sleep(0.6); pg.reload(); pg.wait_for_selector("#coverPlay"); pg.click("#coverPlay"); pg.wait_for_selector("#dlg[open]")
        pg.click("#dF .main"); time.sleep(0.8)
        ok(ev("app.bot && app.bot.level") == "easy" and "الحاسوب" in pg.locator("#pn1").inner_text(), "a resumed match is still against the computer")
        ok(ev("S.hist.length") >= 4, "with its history")
        # medium and hard levels return moves too (direct call, no UI)
        res = pg.evaluate("""async () => { const {solve} = await import('/js/bot-search.js'); const {createDictionary} = await import('/js/dictionary.js');
          const D = createDictionary(new Uint8Array(await (await fetch('/data/words.bin')).arrayBuffer()), new Uint8Array(await (await fetch('/data/common-words.bin')).arrayBuffer())); const {S, app} = await import('/js/state.js'); const {tileLetter, tileValue} = await import('/js/modes.js');
          const grid = S.board.map(r => r.map(t => t ? {l: tileLetter(t), v: tileValue(t)} : null)); const rack = S.players[1].rack.filter(Boolean).map(t => ({id: t.id, l: t.l, v: t.v, blank: !!t.blank, flex: !!t.flex}));
          return ['easy', 'medium', 'hard'].map(level => { const r = solve({grid, rack, mode: app.mode, level, budget: 1200}, D); return [level, r.candidates.length, r.ms]; }); }""")
        ok(all(c > 0 for _, c, _ in res), "all three levels find candidates: " + str(res))
        br.close()
    ok(not errors, "no console / page errors: " + "; ".join(errors[:3]))
finally:
    srv.kill()
print(f"\n{passed} passed, {failed} failed"); raise SystemExit(1 if failed else 0)
