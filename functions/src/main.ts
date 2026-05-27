import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AdkApiServer } from '@google/adk-devtools';

// Import agent.ts to validate it loads without error on startup.
const { rootAgent } = await import('./agent.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const port = parseInt(process.env.PORT ?? '8080');
const host = process.env.ADK_HOST ?? '0.0.0.0';

// Start ADK API Server programmatically
const server = new AdkApiServer({
  agentsDir: __dirname,
  host: host,
  port: port,
  serveDebugUI: true,
  logLevel: 'INFO',
});

console.log(`Clanker agent starting at http://${host}:${port}`);

await server.start();
