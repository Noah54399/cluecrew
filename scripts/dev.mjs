import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const targets = [
  { name: 'server', color: '\u001b[36m', args: ['--workspace', '@cluecrew/server', 'run', 'dev'] },
  { name: 'client', color: '\u001b[35m', args: ['--workspace', '@cluecrew/client', 'run', 'dev'] },
];

const children = [];

function prefixStream(stream, name, color) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      process.stdout.write(`${color}[${name}]\u001b[0m ${line}\n`);
    }
  });
}

for (const target of targets) {
  const child = spawn(npmCmd, target.args, {
    cwd: root,
    shell: process.platform === 'win32',
    env: process.env,
  });
  children.push(child);
  prefixStream(child.stdout, target.name, target.color);
  prefixStream(child.stderr, target.name, target.color);
  child.on('exit', (code) => {
    process.stdout.write(`${target.color}[${target.name}]\u001b[0m exited with code ${code}\n`);
    for (const other of children) {
      if (other !== child && other.exitCode === null) other.kill();
    }
    process.exitCode = code ?? 0;
  });
}

process.on('SIGINT', () => {
  for (const child of children) child.kill();
  process.exit(0);
});
