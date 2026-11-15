"""Room chat inside the word log: players + judge, ephemeral, notification only in the chat. Run: python3 tests/e2e/chat.py"""
import subprocess, uuid, os, time
from pathlib import Path
from playwright.sync_api import sync_playwright
HERE = Path(__file__).parent; PORT = os.environ.get("PORT", "8769"); BASE = f"http://localhost:{PORT}"
OUT = Path("/tmp/e2e-chat"); OUT.mkdir(exist_ok=True)
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
        def player(label, w=1280, h=800):
            uid = str(uuid.uuid4()); ctx = br.new_context(viewport={"width": w, "height": h}); ctx.add_init_script(f"window.__USER='{uid}';" + fake)
            pg = ctx.new_page(); pg.on("pageerror", lambda e, l=label: errors.append(f"{l}: {e}")); return pg
        S = lambda pg, expr: pg.evaluate("async () => { const m = await import('/js/state.js'); const {S, app} = m; return (" + expr + ") }")
        A, B, J, Sp = player("A"), player("B"), player("J"), player("S")
        A.goto(BASE + "/"); A.click("#coverOnline"); A.wait_for_selector("#lbNick"); A.fill("#lbNick", "Sultan"); A.click("[data-a=create]"); A.wait_for_selector(".lbCode"); code = A.inner_text(".lbCode").strip()
        A.click("[data-a=judge][data-v='1']")
        B.goto(BASE + f"/?room={code}"); B.wait_for_selector("#lbCode"); B.fill("#lbNick", "Ahmad"); B.click("[data-a=join]"); B.wait_for_selector("[data-a=ready]"); B.click("[data-a=ready]")
        J.goto(BASE + f"/?room={code}"); J.wait_for_selector("#lbCode"); J.fill("#lbNick", "Hakam"); J.click("[data-a=role][data-v=judge]"); J.click("[data-a=join]"); J.wait_for_selector(".lbRoleBadge")
        Sp.goto(BASE + f"/?room={code}"); Sp.wait_for_selector("#lbCode"); Sp.fill("#lbNick", "Zaid"); Sp.click("[data-a=role][data-v=spectator]"); Sp.click("[data-a=join]"); Sp.wait_for_selector(".lbRoleBadge")
        A.wait_for_function("!document.querySelector('[data-a=start]').disabled"); A.click("[data-a=start]")
        for pg in (A, B, J, Sp): pg.wait_for_selector("#netBar", state="visible"); pg.wait_for_function("document.getElementById('lobby').hidden")
        time.sleep(1)
        for pg in (A, B, J): pg.click("#bLog"); pg.wait_for_selector("#hTabs", state="visible")
        ok(all(pg.locator("#hTabs").is_visible() for pg in (A, B, J)), "players and the judge have the Words / Chat tabs (in the log)")
        B.click("#bLog"); B.wait_for_selector("#hTabs", state="hidden"); ok(True, "B closes the log again")
        ok(Sp.locator("#hTabs").is_hidden(), "the spectator has no chat tab")
        ok(B.locator("#hTabW").get_attribute("aria-selected") == "true" and B.locator("#hChat").is_hidden(), "the word log is the default tab")
        words0 = A.locator("#hList li").count()
        A.click("#hTabC"); A.wait_for_selector("#hChat", state="visible"); ok(A.locator("#hList").is_hidden() or "hHideTab" in (A.locator("#hList").get_attribute("class") or ""), "the chat tab replaces the word log in the same box")
        A.fill("#hChatIn", "السلام عليكم"); A.click("#hChatSend")
        ok("السلام عليكم" in A.inner_text("#hChatL"), "my own line appears at once")
        B.wait_for_function("document.getElementById('bLog').classList.contains('hasChat')"); ok(True, "B (log closed) gets a dot on the log button")
        B.click("#bLog"); B.wait_for_selector("#hTabs", state="visible"); ok(B.inner_text("#hBadge").strip() == "1", "and a badge with the count on the chat tab")
        J.wait_for_function("!document.getElementById('hBadge').hidden"); ok(True, "the judge (log open, Words tab) gets the badge too")
        ok(B.locator("#hList li").count() == A.locator("#hList li").count() == words0 and "السلام" not in B.inner_text("#hList") and "السلام" not in B.inner_text("#hTkL"), "nothing was written into the word log or the decision log")
        ok(Sp.evaluate("document.body.innerText.includes('السلام عليكم')") is False, "the spectator never sees the line")
        B.click("#hTabC"); B.wait_for_selector("#hChat", state="visible")
        ok("السلام عليكم" in B.inner_text("#hChatL") and "Sultan" in B.inner_text("#hChatL") and B.locator("#hBadge").is_hidden() and not B.evaluate("document.getElementById('bLog').classList.contains('hasChat')"), "opening the chat shows the line with its sender and clears the badge and the dot")
        B.fill("#hChatIn", "<b>x</b> وعليكم السلام"); B.click("#hChatSend"); time.sleep(1.2)
        ok("<b>x</b>" in A.inner_text("#hChatL") and A.locator("#hChatL b").count() == 0, "markup in a message is shown as text, never executed")
        # rate limit: two sends within 600 ms -> only the first
        B.fill("#hChatIn", "one"); B.click("#hChatSend"); B.fill("#hChatIn", "two"); B.click("#hChatSend"); time.sleep(1.2)
        ok("one" in A.inner_text("#hChatL") and "two" not in A.inner_text("#hChatL"), "a burst is rate-limited")
        # judge can write
        J.click("#hTabC"); J.wait_for_selector("#hChat", state="visible"); time.sleep(0.8); J.fill("#hChatIn", "أنا الحكم"); J.click("#hChatSend"); time.sleep(1.2)
        ok("أنا الحكم" in A.inner_text("#hChatL") and A.locator("#hChatL .hcm.judge").count() == 1, "the judge can chat (marked)")
        # ephemeral: a refresh loses MY lines, others keep what they saw
        A.reload(); A.wait_for_selector("#netBar", state="visible", timeout=15000); time.sleep(1.5)
        A.click("#bLog"); A.click("#hTabC"); A.wait_for_selector("#hChat", state="visible")
        ok("السلام عليكم" not in A.inner_text("#hChatL"), "after a refresh my own earlier lines are gone (ephemeral)")
        ok("السلام عليكم" in B.inner_text("#hChatL"), "the others still show what they received")
        A.screenshot(path=str(OUT / "chat-A.png"))
        ok(not errors, "no page errors: " + "; ".join(errors[:3]))
        br.close()
finally: srv.terminate()
print(f"\n{passed} passed, {failed} failed"); raise SystemExit(1 if failed else 0)
