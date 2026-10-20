// Run a command, streaming its output to a log, with cancellation and a timeout.
import { spawn } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  log?: (text: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RunResult {
  code: number | null;
  output: string; // stdout and stderr interleaved
}

export class CommandError extends Error {
  constructor(
    message: string,
    public output: string,
  ) {
    super(message);
  }
}

export function run(command: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    opts.log?.(`$ ${[command, ...args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}\n`);
    const child = spawn(command, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      if (output.length > 2_000_000) output = output.slice(-1_000_000);
      opts.log?.(text);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    const kill = () => child.kill('SIGTERM');
    const timer = opts.timeoutMs ? setTimeout(kill, opts.timeoutMs) : undefined;
    opts.signal?.addEventListener('abort', kill, { once: true });

    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new CommandError(`Couldn't run ${command}: ${e.message}`, output));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', kill);
      resolve({ code, output });
    });
  });
}

// Like run(), but rejects on a non-zero exit.
export async function runChecked(command: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const result = await run(command, args, opts);
  if (opts.signal?.aborted) throw new CommandError('Cancelled', result.output);
  if (result.code !== 0) {
    const tail = result.output.trim().split('\n').slice(-15).join('\n');
    throw new CommandError(`${command} ${args[0] ?? ''} failed (exit ${result.code}):\n${tail}`, result.output);
  }
  return result;
}
