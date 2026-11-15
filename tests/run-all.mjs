// npm test: online server suites (real server core on an in-memory store), real-browser online + local runs, logic suites (jsdom), theme contrast audit, then the real-browser layout regression suites.
import { spawn } from 'child_process'; import path from 'path'; import { fileURLToPath } from 'url';
import { serve } from './layout/serve.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '..');
const PY = process.platform === 'win32' ? 'python' : 'python3';   // Windows resolves python3 to a Store stub, not to the interpreter
const { srv, base } = await serve(root);
const runs = [['node', ['../tools/build-common-words.mjs', '--check']], ['node', ['../tools/sync-edge-shared.mjs', '--check']], ['node', ['online/rooms.mjs']], ['node', ['online/game.mjs']], ['node', ['online/security.mjs']], ['node', ['online/network.mjs']], ['node', ['online/endgame.mjs']], ['node', ['online/abandon.mjs']], ['node', ['online/pause-undo.mjs']], ['node', ['online/parity.mjs']], ['node', ['online/tahkim-reason.mjs']], ['node', ['online/draft.mjs']], ['node', ['online/explain.mjs']], ['node', ['online/first-draw.mjs']], ['node', ['online/env-build.mjs']], ['node', ['online/hardening.mjs']], ['node', ['online/tahkim-consensus.mjs']], ['node', ['online/roles.mjs']], ['node', ['online/judge.mjs']], ['node', ['online/nplayer.mjs']], ['node', ['online/slots.mjs']], ['node', ['online/adaptive.mjs']], ['node', ['online/auto-words.mjs']], ['node', ['online/turn-limit.mjs']], ['node', ['logic/hamza.mjs']], ['node', ['logic/validation-outcomes.mjs']],
  [PY, ['e2e/local.py']], [PY, ['e2e/pause-button.py']], [PY, ['e2e/run.py']], [PY, ['e2e/roles.py']], [PY, ['e2e/nplayer.py']], [PY, ['e2e/slots.py']], [PY, ['e2e/floatplayers.py']], [PY, ['e2e/chat.py']], [PY, ['e2e/bot.py']], [PY, ['e2e/autowords.py']], [PY, ['e2e/turnlimit.py']],   // real browsers: local play unchanged; two players through the real server core (python3 + playwright + Chromium)
  [PY, ['contrast.py']], ['node', ['logic/engine.mjs']], ['node', ['logic/endgame.mjs']], ['node', ['logic/startup.mjs']], ['node', ['logic/names.mjs']],
  ['node', ['layout/history-toggle.mjs']], ['node', ['layout/history-toggle-extra.mjs', 'a']], ['node', ['layout/history-toggle-extra.mjs', 'b']], ['node', ['layout/log-icon.mjs']], ['node', ['layout/floating.mjs']], [PY, ['layout/float_modules.py']], ['node', ['layout/layering.mjs']], ['node', ['layout/fluid.mjs']], ['node', ['layout/tools.mjs']], ['node', ['layout/collapse.mjs']], ['node', ['layout/feel.mjs']],
  ['node', ['pwa/static.mjs']], ['node', ['pwa/e2e.mjs']]];   // PWA suites start their own servers; e2e needs playwright-core + Chromium (CHROME_PATH)
// Optional filter: `node run-all.mjs "extra.mjs b"` runs only the suites whose command line contains that text.
const only = process.argv[2];
let bad = 0;
for (const [cmd, args] of runs.filter(([c, a]) => !only || `${c} ${a.join(' ')}`.includes(only))) {
  console.log(`\n=== ${cmd} ${args.join(' ')}`);
  // async spawn on purpose: spawnSync would block this process's event loop, and with it the static server the browser needs
  const code = await new Promise(res => spawn(cmd, args, { cwd: here, stdio: 'inherit', env: { ...process.env, BASE: base } }).on('close', res)); if (code) { bad++; console.log('>>> FAILED (exit ' + code + '): ' + cmd + ' ' + args.join(' ')); }
}
srv.close(); console.log(bad ? `\n${bad} suite(s) FAILED` : '\nALL SUITES PASSED'); process.exit(bad ? 1 : 0);
