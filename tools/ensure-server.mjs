/* Shared preflight for the CDP tools: give the caller a URL that definitely
   serves this app.

   Two problems this closes. First, none of the tools used to start the server,
   which showed up as a confusing timeout rather than "start the server first".
   Second, they all hard-coded port 4321 and assumed anything answering there
   was theirs — a half-dead leftover server produced `chrome-error://` pages
   twenty assertions later, which reads like an app bug and is not one.
   So: only reuse a port that actually serves our index.html, otherwise bind a
   private one. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/* Not just "something answered" — it has to be this app. */
const serves = async (port) => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/index.html`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok && (await response.text()).includes('id="app"');
  } catch {
    return false;
  }
};

const freePort = () =>
  new Promise((ok, err) => {
    const probe = createServer();
    probe.once('error', err);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => ok(port));
    });
  });

export async function ensureServer(preferred = 4321) {
  if (await serves(preferred)) return { port: preferred, base: `http://127.0.0.1:${preferred}/`, reused: true };

  const port = await freePort();
  /* fileURLToPath, not URL.pathname: the latter yields /C:/... on Windows,
     which spawn cannot resolve. */
  const server = fileURLToPath(new URL('./serve.mjs', import.meta.url));
  const child = spawn(process.execPath, [server, String(port)], {
    stdio: 'ignore',
    detached: false,
  });
  child.on('error', () => {});
  child.unref();
  process.on('exit', () => child.kill());

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await serves(port)) return { port, base: `http://127.0.0.1:${port}/`, reused: false };
    await sleep(150);
  }
  throw new Error(`could not start the static server on port ${port}`);
}
