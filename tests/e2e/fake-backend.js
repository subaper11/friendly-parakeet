// Injected into every test page BEFORE the app runs: the browser-side half of the stand-in for Supabase (same contract as supabase-backend.js).
window.EAS_BACKEND_FACTORY = () => {
  const user = window.__USER; let gid = null, meta = {};
  return {
    async init() { return user; },
    async call(body) { const r = await fetch('/__api', { method: 'POST', body: JSON.stringify({ user, body }) }); return r.json(); },
    async subscribe(gameId, h) {
      gid = gameId; let since = 0, last = '', lastAll = '', alive = true;
      setTimeout(() => h.onStatus?.('SUBSCRIBED'), 0);
      const poll = async () => {
        if (!alive) return;
        try {
          const r = await (await fetch(`/__events?game=${gameId}&user=${user}&since=${since}&opp=${encodeURIComponent(h.oppId?.() || '')}`)).json();
          since = r.next;
          for (const e of r.events) h.onEvent?.({ revision: e.revision, status: e.status, event: e.event });
          const key = r.presence.join(',') + JSON.stringify(r.peer || null); if (key !== last) { last = key; h.onPresence?.(r.presence, r.peer || null); }
          { const k2 = JSON.stringify(r.all || {}); if (k2 !== lastAll) { lastAll = k2; h.onPeers?.(r.all || {}); } }
        } catch { /* the test server is local */ }
        setTimeout(poll, 250);
      };
      poll(); return { close() { alive = false; } };
    },
    track(patch) { meta = { ...meta, ...patch }; if (gid) fetch('/__track', { method: 'POST', body: JSON.stringify({ game: gid, user, meta }) }).catch(() => {}); }
  };
};
