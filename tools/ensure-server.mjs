/* Shared preflight for the CDP tools.

   Every tool in this folder needs the static server running, and none of them
   started it — which shows up as a confusing timeout rather than "start the
   server first". This pings the port and, if nothing is listening, spawns the
   server as a detached child that exits when the tool does. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export async function ensureServer(port = 4321) {
  const probe = async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1200) });
      return response.ok;
    } catch {
      return false;
    }
  };

  if (await probe()) return { started: false, port };

  /* fileURLToPath, not URL.pathname: the latter yields /C:/... on Windows,
     which spawn cannot resolve. */
  const server = fileURLToPath(new URL('./serve.mjs', import.meta.url));
  const child = spawn(process.execPath, [server, String(port)], {
    stdio: 'ignore',
    detached: false,
  });
  child.unref();
  process.on('exit', () => child.kill());

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await probe()) return { started: true, port };
    await sleep(150);
  }
  throw new Error(`could not start the static server on port ${port}`);
}
