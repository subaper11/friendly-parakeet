"""Floating Workspace with a 3 player room: the players-info strip and the racks of seats 3-4 move and resize. Run: python3 tests/e2e/floatplayers.py"""
import subprocess, uuid, os, time
from pathlib import Path
from playwright.sync_api import sync_playwright
HERE = Path(__file__).parent; PORT = os.environ.get("PORT", "8768"); BASE = f"http://localhost:{PORT}"
OUT = Path("/tmp/e2e-float"); OUT.mkdir(exist_ok=True)
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
        def player(label):
            uid = str(uuid.uuid4()); ctx = br.new_context(viewport={"width": 1280, "height": 800}); ctx.add_init_script(f"window.__USER='{uid}';" + fake)
            ctx.add_init_script("try{if(!localStorage.getItem('scrabble.floatWorkspace.v2'))localStorage.setItem('scrabble.floatWorkspace.v2', JSON.stringify({v:2,enabled:true,portrait:{},landscape:{}}))}catch(e){}")
            pg = ctx.new_page(); pg.on("pageerror", lambda e, l=label: errors.append(f"{l}: {e}")); return pg
        S = lambda pg, expr: pg.evaluate("async () => { const m = await import('/js/state.js'); const {S, app} = m; return (" + expr + ") }")
        names = ["A", "B", "C"]; pgs = {k: player(k) for k in names}; A = pgs["A"]
        A.goto(BASE + "/"); A.click("#coverOnline"); A.wait_for_selector("#lbNick"); A.fill("#lbNick", "A"); A.click("[data-a=create]"); A.wait_for_selector(".lbCode"); code = A.inner_text(".lbCode").strip()
        A.click("[data-a=maxp][data-v='3']")
        for k in names[1:]:
            pg = pgs[k]; pg.goto(BASE + f"/?room={code}"); pg.wait_for_selector("#lbCode"); pg.fill("#lbNick", k); pg.click("[data-a=join]"); pg.wait_for_selector("[data-a=ready]"); pg.click("[data-a=ready]")
        A.wait_for_function("!document.querySelector('[data-a=start]').disabled"); A.click("[data-a=start]")
        for pg in pgs.values(): pg.wait_for_selector("#netBar", state="visible"); pg.wait_for_function("document.documentElement.dataset.floating==='true' && document.querySelectorAll('#turnList .tsItem').length===3")
        ok(True, "floating workspace stays ON in a 3-player room")
        for k in names:
            pg = pgs[k]; seat = S(pg, "app.net.seat")
            ok(pg.locator(f"#pn{seat}").is_visible() and pg.locator(f"#pn{seat} .flMove").count() == 1, f"{k}: my rack panel (seat {seat}) is a floating module with a move bar")
            ok(pg.locator("#turnStrip .flMove, #turnStrip .tsGrip").count() >= 1 and pg.locator("#turnStrip .flGrip").count() == 1, f"{k}: the players-info strip has a move handle and a resize grip")
        # move the strip on C (seat 2)
        C = pgs["C"]; box = C.locator("#turnStrip"); b0 = box.bounding_box()
        h = C.locator("#tsGrip").bounding_box(); C.mouse.move(h["x"] + h["width"] / 2, h["y"] + h["height"] / 2); C.mouse.down(); C.mouse.move(h["x"] + 160, h["y"] + 200, steps=8); C.mouse.up()
        b1 = box.bounding_box(); ok(abs(b1["x"] - b0["x"]) > 80 and abs(b1["y"] - b0["y"]) > 80, f"the strip moved: ({b0['x']:.0f},{b0['y']:.0f}) -> ({b1['x']:.0f},{b1['y']:.0f})")
        g = C.locator("#turnStrip .flGrip").bounding_box(); C.mouse.move(g["x"] + g["width"] / 2, g["y"] + g["height"] / 2); C.mouse.down(); C.mouse.move(g["x"] - 140, g["y"] + 60, steps=8); C.mouse.up()
        b2 = box.bounding_box(); ok(abs(b2["width"] - b1["width"]) > 40 or abs(b2["height"] - b1["height"]) > 20, f"the strip resized: {b1['width']:.0f}x{b1['height']:.0f} -> {b2['width']:.0f}x{b2['height']:.0f}")
        # my rack panel (seat 2) moves too
        pn = C.locator("#pn2"); r0 = pn.bounding_box(); mv = C.locator("#pn2 .flMove").bounding_box()
        C.mouse.move(mv["x"] + mv["width"] / 2, mv["y"] + mv["height"] / 2); C.mouse.down(); C.mouse.move(mv["x"] - 90, mv["y"] - 120, steps=8); C.mouse.up()
        r1 = pn.bounding_box(); ok(abs(r1["x"] - r0["x"]) > 40 or abs(r1["y"] - r0["y"]) > 40, f"the seat-3 rack panel moved: ({r0['x']:.0f},{r0['y']:.0f}) -> ({r1['x']:.0f},{r1['y']:.0f})")
        # persistence across a reload
        pos = C.locator("#turnStrip").bounding_box(); C.reload(); C.wait_for_selector("#turnStrip", timeout=15000); time.sleep(1.2)
        pos2 = C.locator("#turnStrip").bounding_box() if C.locator("#turnStrip").count() else None
        ok(pos2 is not None and abs(pos2["x"] - pos["x"]) < 40 and abs(pos2["y"] - pos["y"]) < 40, f"the new place is remembered after a reload: {pos} -> {pos2}")
        C.screenshot(path=str(OUT / "float-3p.png"))
        ok(not errors, "no page errors: " + "; ".join(errors[:3]))
        br.close()
finally:
    srv.terminate()
    if errors: print('PAGE ERRORS:', errors[:4])
print(f"\n{passed} passed, {failed} failed"); raise SystemExit(1 if failed else 0)
