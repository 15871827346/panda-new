/* One place to launch the browser the checks run in.

   Each tool used to pin its own --remote-debugging-port (9333, 9345, 9347…).
   Two runs of the same tool — or one of the other agents working in parallel —
   then silently attached to *someone else's* Chromium and reported its results
   as its own. Port 0 plus a throwaway profile makes that impossible: the
   browser writes its real port into DevToolsActivePort inside that profile
   directory, and nobody else can be looking there. */
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const CHROME =
  'C:/Users/24772/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export async function startChrome({ width = 1440, height = 900, extraArgs = [] } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'panda-cdp-'));
  const portFile = join(profile, 'DevToolsActivePort');
  const proc = spawn(
    CHROME,
    [
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      '--remote-allow-origins=*',
      '--no-sandbox',
      '--disable-gpu',
      `--window-size=${width},${height}`,
      ...extraArgs,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let port = null;
  for (let i = 0; i < 120 && !port; i += 1) {
    if (existsSync(portFile)) {
      try {
        port = Number(readFileSync(portFile, 'utf8').split('\n')[0].trim());
      } catch {
        /* the file is written in two steps; read it again */
      }
    }
    if (!port) await sleep(100);
  }
  if (!port) {
    proc.kill();
    throw new Error('DevToolsActivePort never appeared — is Chrome still installed at ' + CHROME);
  }

  let page = null;
  for (let i = 0; i < 40 && !page; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = list.find((target) => target.type === 'page')?.webSocketDebuggerUrl ?? null;
    } catch {
      /* still starting */
    }
    if (!page) await sleep(150);
  }
  if (!page) {
    proc.kill();
    throw new Error('no devtools page target');
  }

  return {
    port,
    websocket: page,
    async cleanup() {
      proc.kill();
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}
