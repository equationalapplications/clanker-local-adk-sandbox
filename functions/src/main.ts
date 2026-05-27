import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Import agent.ts to validate it loads without error on startup.
await import('./agent.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agentFile = path.join(__dirname, 'agent.js');

const port = process.env.PORT ?? '8080';
const host = process.env.ADK_HOST ?? '0.0.0.0';

// adk web is CLI-only based on API findings - spawn as child process
const child = spawn(
  'npx',
  ['adk', 'web', agentFile, '--port', port, '--host', host],
  { stdio: 'inherit', env: process.env }
);

console.log(`Clanker agent starting at http://${host}:${port}`);

child.on('exit', (code) => {
  console.log(`Agent process exited with code ${code}`);
  process.exit(code ?? 0);
});
