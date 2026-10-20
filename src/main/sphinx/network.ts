// Is the internet (or the configured mirror) reachable? Checked before downloading,
// so an offline machine gets a clear answer in seconds rather than after timeouts.
import { lookup } from 'node:dns/promises';
import { connect } from 'node:net';

function hostOf(url: string | undefined, fallback: string): string {
  try {
    return url ? new URL(url).hostname : fallback;
  } catch {
    return fallback;
  }
}

function reachable(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(false), timeoutMs);
    const socket = connect({ host, port });
    const done = (ok: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

// Hosts uv needs: the package index, and the Python download server if no managed
// Python is installed yet. Honors uv's mirror settings.
export async function canDownload(needPython: boolean, timeoutMs = 4000): Promise<boolean> {
  if (process.env.UV_OFFLINE) return false;
  const index = process.env.UV_DEFAULT_INDEX ?? process.env.UV_INDEX_URL;
  const hosts = [hostOf(index, 'pypi.org')];
  if (needPython) hosts.push(hostOf(process.env.UV_PYTHON_INSTALL_MIRROR, 'github.com'));
  for (const host of hosts) {
    if (host === 'localhost' || host === '' || /^file:/.test(index ?? '')) continue;
    try {
      await Promise.race([lookup(host), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))]);
    } catch {
      return false;
    }
    if (!(await reachable(host, 443, timeoutMs))) return false;
  }
  return true;
}
