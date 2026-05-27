// tsx is registered via --import tsx/esm in the Dockerfile CMD
// This allows dynamic TypeScript imports at runtime for ADK agent discovery

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AdkApiServer } from '@google/adk-devtools';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

console.log(`[main] __dirname: ${__dirname}`);
console.log(`[main] projectRoot: ${projectRoot}`);

// Import agent.ts to validate it loads without error on startup.
const { rootAgent } = await import('./agent.js');
console.log(`[main] Agent loaded: ${rootAgent?.name}`);

const port = parseInt(process.env.PORT ?? '8080');
const host = process.env.ADK_HOST ?? '0.0.0.0';

// Point to src/ so AgentLoader finds agent.ts without scanning node_modules.
// compile: false keeps @google/adk in the same process instance so isBaseAgent passes.
const agentsDir = path.join(projectRoot, 'src');
const server = new AdkApiServer({
  agentsDir,
  host,
  port,
  serveDebugUI: true,
  logLevel: 'DEBUG' as 'DEBUG',
  agentFileLoadOptions: { compile: false, bundle: false },
});

console.log(`[main] agentsDir: ${agentsDir}`);
console.log(`Clanker agent starting at http://${host}:${port}`);

await server.start();
