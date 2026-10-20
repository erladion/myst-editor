// Answering git's and ssh's questions (passwords, passphrases, host keys) in the app.
//
// git and ssh run a program named in GIT_ASKPASS / SSH_ASKPASS with the question as
// its argument and read the answer from its output. Ours is a tiny Node script run
// by Electron itself; it forwards the question over a private Unix socket (with a
// random token) to the main process, which asks the writer.
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';

const HELPER = `// Written by MyST Editor: forwards a git/ssh question to the app.
const net = require('net');
const question = process.argv.slice(2).join(' ');
let reply = '';
const socket = net.connect(process.env.MYSTEDITOR_ASKPASS_SOCKET, () => {
  socket.write(JSON.stringify({ token: process.env.MYSTEDITOR_ASKPASS_TOKEN, question }) + '\\n');
});
socket.on('data', (d) => (reply += d));
socket.on('end', () => {
  let answer = null;
  try { answer = JSON.parse(reply).answer; } catch {}
  if (typeof answer !== 'string') process.exit(1);
  process.stdout.write(answer + '\\n');
  process.exit(0);
});
socket.on('error', () => process.exit(1));
`;

export type Asker = (question: string) => Promise<string | null>;

export class AskPass {
  private server: Server | null = null;
  private readonly token = randomBytes(24).toString('hex');
  readonly dir: string;
  private readonly socketPath: string;
  private readonly script: string;

  constructor(
    baseDir: string,
    private ask: Asker,
  ) {
    this.dir = join(baseDir, 'git');
    this.socketPath = join(this.dir, `askpass-${process.pid}.sock`);
    this.script = join(this.dir, 'askpass');
  }

  async start(): Promise<void> {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.dir, 0o700);
    writeFileSync(join(this.dir, 'askpass.cjs'), HELPER, { mode: 0o600 });
    // GIT_ASKPASS must name a single program: a shell wrapper that runs the helper
    // with Electron acting as Node.
    writeFileSync(
      this.script,
      `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(this.dir, 'askpass.cjs'))} "$@"\n`,
      { mode: 0o700 },
    );
    rmSync(this.socketPath, { force: true });
    this.server = createServer((socket) => {
      let data = '';
      socket.on('data', async (chunk) => {
        data += chunk;
        if (!data.includes('\n')) return;
        let answer: string | null = null;
        try {
          const { token, question } = JSON.parse(data.split('\n')[0]);
          if (token === this.token && typeof question === 'string') answer = await this.ask(question);
        } catch {
          // malformed request: answer nothing
        }
        socket.end(JSON.stringify({ answer }));
      });
      socket.on('error', () => {});
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.socketPath, () => resolve());
    });
    chmodSync(this.socketPath, 0o600);
  }

  // Environment for git commands, so every prompt comes to the app, never a terminal.
  env(): NodeJS.ProcessEnv {
    return {
      GIT_ASKPASS: this.script,
      SSH_ASKPASS: this.script,
      SSH_ASKPASS_REQUIRE: 'force',
      GIT_TERMINAL_PROMPT: '0',
      MYSTEDITOR_ASKPASS_SOCKET: this.socketPath,
      MYSTEDITOR_ASKPASS_TOKEN: this.token,
    };
  }

  stop() {
    this.server?.close();
    rmSync(this.socketPath, { force: true });
  }
}
