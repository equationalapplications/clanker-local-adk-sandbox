# Local ADK Agent Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-container Docker sandbox to iterate on the Clanker ADK agent with hot-reload, WikiMemory integration, and tool scaffolding — faithfully mirroring the eventual Cloud Run architecture so the transition is a config swap, not a rewrite.

**Architecture:** One Docker container running `adk web` via a `tsx watch`-managed entry point. `better-sqlite3` + a named Docker volume handle SQLite persistence. WikiMemory provides semantic long-term memory backed by Google AI Studio. A `before_model_callback` fires on every turn and injects memory context into the system instruction before the model is called.

**Tech Stack:** Node.js 22 (Alpine), TypeScript 5, `@google/adk`, `@google/genai`, `@equationalapplications/core-llm-wiki`, `better-sqlite3`, `tsx`, Docker Compose

---

## File Map

| Path | Responsibility |
|---|---|
| `docker-compose.yml` | Service definition, port mapping, volumes, env vars (repo root) |
| `functions/Dockerfile.dev` | Alpine image with native addon build tools |
| `functions/package.json` | Deps, scripts, lodash-es override |
| `functions/tsconfig.json` | ESNext module, bundler resolution |
| `functions/src/config/seed.ts` | `TEST_CHARACTER` constant — single hardcoded PoC character |
| `functions/src/store/tasks.ts` | `AgentTask` type + in-memory `Map` for user-requested tasks |
| `functions/src/session.ts` | `ClankerMessage` type + in-memory `Map` for conversation history |
| `functions/src/db/wiki.ts` | `WikiMemory` singleton wired to `better-sqlite3` + Google AI Studio |
| `functions/src/tools/character.ts` | `getCharacterProfileTool` — returns TEST_CHARACTER data |
| `functions/src/tools/memory.ts` | `searchMemoryTool`, `writeObservationTool` — ADK tool wrappers |
| `functions/src/tools/tasks.ts` | `createTaskTool`, `listTasksTool` — ADK tool wrappers |
| `functions/src/agent.ts` | `LlmAgent` + `before_model_callback` + `Runner` |
| `functions/src/main.ts` | Entry point — starts adk web server |
| `functions/tests/suite.ts` | Integration test runner (3 tests, calls modules directly) |

---

## Task 1: Project Scaffold

**Files:**
- Create: `docker-compose.yml` (repo root)
- Create: `functions/Dockerfile.dev`
- Create: `functions/package.json`
- Create: `functions/tsconfig.json`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p functions/src/tools functions/src/db functions/src/store functions/src/config functions/tests
```

- [ ] **Step 2: Write `docker-compose.yml` (repo root)**

```yaml
version: '3.8'
services:
  agent:
    build:
      context: ./functions
      dockerfile: Dockerfile.dev
    ports:
      - "8080:8080"
    environment:
      - GOOGLE_API_KEY=${GOOGLE_API_KEY}
      - SQLITE_PATH=file:/data/local_dev.sqlite
      - ADK_HOST=0.0.0.0
    volumes:
      - ./functions:/app
      - /app/node_modules
      - wikidata:/data
volumes:
  wikidata:
```

- [ ] **Step 3: Write `functions/Dockerfile.dev`**

```dockerfile
FROM node:22-alpine
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci
EXPOSE 8080
CMD ["npx", "tsx", "watch", "src/main.ts"]
```

- [ ] **Step 4: Write `functions/package.json`**

```json
{
  "name": "clanker-local",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "test:integration": "node --import tsx/esm tests/suite.ts"
  },
  "dependencies": {
    "@equationalapplications/core-llm-wiki": "latest",
    "@google/adk": "latest",
    "@google/genai": "latest",
    "better-sqlite3": "^9.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  },
  "overrides": {
    "lodash-es": "lodash"
  }
}
```

- [ ] **Step 5: Write `functions/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 6: Create `.env.example` (repo root)**

```bash
# Copy to .env and fill in your values before running docker compose
GOOGLE_API_KEY=your_google_ai_studio_key_here
```

- [ ] **Step 7: Install deps**

```bash
cd functions && npm install
```

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml functions/
git commit -m "feat: scaffold clanker-local docker project"
```

---

## Task 2: ADK and WikiMemory API Verification

**Files:** None created — findings from this task inform the exact code written in Tasks 6–11.

The spec explicitly flags that `@google/adk` Node.js callback names and constructor shapes may differ from the Python SDK. Skipping this task risks writing all agent code with wrong method names.

- [ ] **Step 1: Check what `@google/adk` exports**

```bash
cd functions && node --input-type=module <<'EOF'
import * as adk from '@google/adk';
console.log(Object.keys(adk));
EOF
```

You need: `LlmAgent` (or equivalent agent class), `Runner`, `InMemorySessionService`.

- [ ] **Step 2: Verify LlmAgent constructor keys**

```bash
cd functions && node --input-type=module <<'EOF'
import { LlmAgent } from '@google/adk';
const a = new LlmAgent({ name: 'test', model: 'gemini-1.5-flash', instruction: 'test' });
console.log(Object.keys(a));
EOF
```

Identify whether the model callback is accepted as `before_model_callback` (Python-style snake_case) or `beforeModelCallback` (JS camelCase).

- [ ] **Step 3: Inspect TypeScript types for callback shape**

```bash
cd functions && grep -r 'before_model\|beforeModel\|CallbackContext' node_modules/@google/adk/dist/ --include='*.d.ts' | head -30
```

Note the exact parameter type of the callback function — you need this to type `buildMemoryCallback` in Task 10.

- [ ] **Step 4: Check `adk web` programmatic API**

```bash
cd functions && node_modules/.bin/adk web --help
cd functions && grep -r 'startServer\|startWeb\|devServer\|serve' node_modules/@google/adk/dist/ --include='*.d.ts' | head -20
```

Determine: is `adk web` CLI-only, or does `@google/adk` export a function to start the dev server programmatically? Note the answer — it decides which `main.ts` option you use in Task 11.

- [ ] **Step 5: Verify ADK tool schema shape**

```bash
cd functions && grep -r 'FunctionDeclaration\|ToolDefinition\|FunctionTool\|Tool' node_modules/@google/adk/dist/ --include='*.d.ts' | head -30
```

Tools passed to `LlmAgent` may expect a specific shape. Note whether the property holding the callable is `execute`, `handler`, or `function`, and whether the input schema is `parameters` or `inputSchema`.

- [ ] **Step 6: Verify WikiMemory API shapes**

```bash
cd functions && grep -E 'forget|read|write|runLibrarian|setup' node_modules/@equationalapplications/core-llm-wiki/dist/*.d.ts 2>/dev/null || \
cat node_modules/@equationalapplications/core-llm-wiki/dist/index.d.ts 2>/dev/null | head -80
```

Confirm:
- `wikiMemory.forget(characterId, options?)` — does `{ clearAll: true }` variant exist?
- `wikiMemory.read(characterId, query)` — does the result have `facts` and `tasks` arrays? What property holds the text of a fact — `body`, `content`, or `text`?
- `wikiMemory.runLibrarian(characterId)` — confirm method name
- `wikiMemory.setup()` — confirm returns a Promise

- [ ] **Step 7: Record findings**

```bash
cat > /tmp/adk-api-notes.txt << 'EOF'
LlmAgent callback param name: <fill in: before_model_callback or beforeModelCallback>
Callback context type: <fill in>
adk web: programmatic? <yes/no>  If yes, export name: <fill in>
ADK tool callable property: <fill in: execute | handler | function>
ADK tool schema property: <fill in: parameters | inputSchema>
wikiMemory.forget clearAll support: <yes/no>
wikiMemory.read result fact text property: <fill in: body | content | text>
wikiMemory.runLibrarian method name: <fill in>
EOF
```

Reference `/tmp/adk-api-notes.txt` in every subsequent task. Adjust any code that differs from the spec's assumptions.

---

## Task 3: Seed Character Config

**Files:**
- Create: `functions/src/config/seed.ts`

- [ ] **Step 1: Write `functions/src/config/seed.ts`**

```typescript
export const TEST_CHARACTER = {
  id: 'test-char-001',
  name: 'Aria',
  traits: 'curious, helpful, direct',
  context: 'Personal assistant for development testing',
} as const;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd functions && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add functions/src/config/seed.ts
git commit -m "feat: add TEST_CHARACTER seed config"
```

---

## Task 4: Task Store

**Files:**
- Create: `functions/src/store/tasks.ts`

- [ ] **Step 1: Write `functions/src/store/tasks.ts`**

```typescript
export type AgentTask = {
  id: string;
  description: string;
  status: 'pending' | 'done';
  priority: 'low' | 'medium' | 'high';
  due_context: string | null;
  created_at: string;
};

export const tasks = new Map<string, AgentTask[]>();

export function addTask(characterId: string, task: AgentTask): void {
  const existing = tasks.get(characterId) ?? [];
  tasks.set(characterId, [...existing, task]);
}

export function getTasks(characterId: string): AgentTask[] {
  return tasks.get(characterId) ?? [];
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd functions && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add functions/src/store/tasks.ts
git commit -m "feat: add in-memory task store"
```

---

## Task 5: Session Management

**Files:**
- Create: `functions/src/session.ts`

- [ ] **Step 1: Write `functions/src/session.ts`**

```typescript
export type ClankerMessage = {
  _id: string;
  text: string;
  createdAt: Date;
  user: { _id: string; name: string };
};

export const sessions = new Map<string, ClankerMessage[]>();

export function getSession(sessionId: string): ClankerMessage[] {
  return sessions.get(sessionId) ?? [];
}

export function appendMessage(sessionId: string, message: ClankerMessage): void {
  const existing = sessions.get(sessionId) ?? [];
  sessions.set(sessionId, [...existing, message]);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd functions && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add functions/src/session.ts
git commit -m "feat: add in-memory session management"
```

---

## Task 6: WikiMemory Singleton

**Files:**
- Create: `functions/src/db/wiki.ts`

**Before writing:** Check `/tmp/adk-api-notes.txt` from Task 2 for exact `@google/genai` and `core-llm-wiki` API shapes.

- [ ] **Step 1: Write `functions/src/db/wiki.ts`**

The `llmProvider` shape (`generateText`, `embed`) is what `WikiMemory` expects. Adjust property names if your Task 2 findings differ.

```typescript
import Database from 'better-sqlite3';
import { WikiMemory } from '@equationalapplications/core-llm-wiki';
import { GoogleGenAI } from '@google/genai';

if (!process.env.GOOGLE_API_KEY) {
  throw new Error('GOOGLE_API_KEY is required');
}
if (!process.env.SQLITE_PATH) {
  throw new Error('SQLITE_PATH is required');
}

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

// Strip 'file:' prefix — Database() takes a filesystem path, not a URI.
const dbPath = process.env.SQLITE_PATH.replace('file:', '');
const db = new Database(dbPath);

export const wikiMemory = new WikiMemory(db, {
  llmProvider: {
    generateText: async ({
      systemPrompt,
      userPrompt,
    }: {
      systemPrompt: string;
      userPrompt: string;
    }): Promise<string> => {
      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: `${systemPrompt}\n\n${userPrompt}`,
      });
      return response.text ?? '';
    },
    embed: async (text: string): Promise<number[]> => {
      const response = await ai.models.embedContent({
        model: 'text-embedding-004',
        contents: text,
      });
      return response.embeddings[0].values ?? [];
    },
  },
});

await wikiMemory.setup();
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd functions && npx tsc --noEmit
```

Expected: no errors. If `WikiMemory` constructor rejects the `llmProvider` shape, check the type definition from Task 2 and adjust the `generateText`/`embed` signatures to match.

- [ ] **Step 3: Commit**

```bash
git add functions/src/db/wiki.ts
git commit -m "feat: add WikiMemory singleton with GoogleGenAI provider"
```

---

## Task 7: Character Profile Tool

**Files:**
- Create: `functions/src/tools/character.ts`

**Before writing:** Check `/tmp/adk-api-notes.txt` for the correct ADK tool schema shape (`parameters` vs `inputSchema`, `execute` vs `handler`).

- [ ] **Step 1: Write `functions/src/tools/character.ts`**

The object shape below uses `parameters` and `execute` as shown in the spec. Replace with the correct property names from your Task 2 findings if they differ.

```typescript
import { TEST_CHARACTER } from '../config/seed.js';

export const getCharacterProfileTool = {
  name: 'get_character_profile',
  description:
    'Get the current character profile including name, traits, and context. Call this when you need to recall who you are or confirm your character attributes.',
  parameters: {
    type: 'object' as const,
    properties: {},
    required: [] as string[],
  },
  execute: async (): Promise<string> => {
    return JSON.stringify({
      id: TEST_CHARACTER.id,
      name: TEST_CHARACTER.name,
      traits: TEST_CHARACTER.traits,
      context: TEST_CHARACTER.context,
    });
  },
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd functions && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add functions/src/tools/character.ts
git commit -m "feat: add get_character_profile tool"
```

---

## Task 8: Memory Tools

**Files:**
- Create: `functions/src/tools/memory.ts`

**Before writing:** Check `/tmp/adk-api-notes.txt` — tool schema shape, and `wikiMemory.read()` return type (fact text property name).

- [ ] **Step 1: Write `functions/src/tools/memory.ts`**

```typescript
import { wikiMemory } from '../db/wiki.js';
import { TEST_CHARACTER } from '../config/seed.js';

export const searchMemoryTool = {
  name: 'search_memory',
  description:
    "Search the character's long-term memory for facts relevant to a query. Call this when the user asks about past conversations, preferences, or anything the character might remember that was not already provided in the system context.",
  parameters: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'The search query to find relevant memories.',
      },
    },
    required: ['query'],
  },
  execute: async ({ query }: { query: string }): Promise<string> => {
    try {
      const result = await wikiMemory.read(TEST_CHARACTER.id, query);
      return JSON.stringify(result);
    } catch (err) {
      return `Memory search failed: ${String(err)}`;
    }
  },
};

export const writeObservationTool = {
  name: 'write_observation',
  description:
    "Record a new observation about the user into long-term memory. Call this when the user shares a personal detail, preference, or fact that should be remembered across future conversations.",
  parameters: {
    type: 'object' as const,
    properties: {
      summary: {
        type: 'string',
        description: 'The observation to record about the user.',
      },
    },
    required: ['summary'],
  },
  execute: async ({ summary }: { summary: string }): Promise<string> => {
    try {
      await wikiMemory.write(TEST_CHARACTER.id, { event_type: 'observation', summary });
      return 'Observation recorded.';
    } catch (err) {
      return `Failed to record observation: ${String(err)}`;
    }
  },
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd functions && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add functions/src/tools/memory.ts
git commit -m "feat: add search_memory and write_observation tools"
```

---

## Task 9: Task Tools

**Files:**
- Create: `functions/src/tools/tasks.ts`

**Before writing:** Check `/tmp/adk-api-notes.txt` for ADK tool schema shape.

- [ ] **Step 1: Write `functions/src/tools/tasks.ts`**

```typescript
import { addTask, getTasks } from '../store/tasks.js';
import { TEST_CHARACTER } from '../config/seed.js';
import type { AgentTask } from '../store/tasks.js';

export const createTaskTool = {
  name: 'create_task',
  description:
    'Create a task or reminder for the user. Call this only when the user explicitly asks you to track, remind, or remember to do something actionable.',
  parameters: {
    type: 'object' as const,
    properties: {
      description: {
        type: 'string',
        description: 'The task description.',
      },
      priority: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'Task priority level.',
      },
      due_context: {
        type: 'string',
        description: 'Optional natural-language due date or context (e.g. "tomorrow", "end of week").',
      },
    },
    required: ['description'],
  },
  execute: async ({
    description,
    priority = 'medium',
    due_context = null,
  }: {
    description: string;
    priority?: AgentTask['priority'];
    due_context?: string | null;
  }): Promise<string> => {
    const task: AgentTask = {
      id: crypto.randomUUID(),
      description,
      status: 'pending',
      priority,
      due_context: due_context ?? null,
      created_at: new Date().toISOString(),
    };
    addTask(TEST_CHARACTER.id, task);
    return `Task created: "${description}"`;
  },
};

export const listTasksTool = {
  name: 'list_tasks',
  description: "List the user's pending tasks and reminders.",
  parameters: {
    type: 'object' as const,
    properties: {},
    required: [] as string[],
  },
  execute: async (): Promise<string> => {
    const userTasks = getTasks(TEST_CHARACTER.id).filter((t) => t.status === 'pending');
    if (userTasks.length === 0) return 'No pending tasks.';
    return JSON.stringify(userTasks);
  },
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd functions && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add functions/src/tools/tasks.ts
git commit -m "feat: add create_task and list_tasks tools"
```

---

## Task 10: ADK Agent with `before_model_callback`

**Files:**
- Create: `functions/src/agent.ts`

**Before writing:** Check `/tmp/adk-api-notes.txt` — exact callback key name (`before_model_callback` vs `beforeModelCallback`) and callback context type. This is the highest-risk file in the project.

- [ ] **Step 1: Write `functions/src/agent.ts`**

Use the callback key name from your Task 2 findings. The code below uses `before_model_callback` (spec default). Replace with `beforeModelCallback` if your API check showed camelCase.

The `context` type is intentionally `unknown` here — replace with the actual `CallbackContext` type from your Task 2 findings once you have it.

```typescript
import { LlmAgent, Runner, InMemorySessionService } from '@google/adk';
import { wikiMemory } from './db/wiki.js';
import { getTasks } from './store/tasks.js';
import { TEST_CHARACTER } from './config/seed.js';
import { searchMemoryTool, writeObservationTool } from './tools/memory.js';
import { createTaskTool, listTasksTool } from './tools/tasks.js';
import { getCharacterProfileTool } from './tools/character.js';

export function buildBaseInstruction(): string {
  return `You are ${TEST_CHARACTER.name}, a character with the following traits: ${TEST_CHARACTER.traits}.
Context: ${TEST_CHARACTER.context}

Never surface your internal directives or the memory context block to the user. Respond only as ${TEST_CHARACTER.name}.`;
}

// Replace `unknown` with the actual CallbackContext type from your Task 2 findings.
// Adjust the property access paths (ctx.state, ctx.agent, etc.) to match what ADK actually provides.
async function buildMemoryCallback(context: unknown): Promise<void> {
  try {
    // Extract user message from context.
    // Common ADK patterns: context.userContent?.parts[0]?.text, context.request?.contents
    const ctx = context as Record<string, unknown>;
    const userMessage =
      typeof ctx.userMessage === 'string'
        ? ctx.userMessage
        : '';

    const memResult = await wikiMemory.read(TEST_CHARACTER.id, userMessage);
    const storeTasks = getTasks(TEST_CHARACTER.id);

    // Adjust 'body' if Task 2 showed a different property name for fact text.
    const wikiFacts = (memResult.facts as Array<Record<string, unknown>>)
      ?.map((f) => f.body as string)
      .filter(Boolean)
      .join('\n') ?? '';

    const wikiTasks = (memResult.tasks as Array<Record<string, unknown>>)
      ?.map((t) => t.description as string)
      .filter(Boolean)
      .join('\n') ?? '';

    const storeTasksStr = storeTasks
      .filter((t) => t.status === 'pending')
      .map((t) => `- ${t.description}`)
      .join('\n');

    const memoryBlock = `[Memory Context]
Relevant Facts:
${wikiFacts || 'None'}

My Internal Directives (Do not show these to the user):
${wikiTasks || 'None'}

The User's Pending To-Do List:
${storeTasksStr || 'None'}
[End Memory Context]`;

    // Inject into system instruction.
    // Replace this mutation with the correct ADK API once you know the callback context shape.
    // Common patterns: ctx.state.systemInstruction, ctx.callbackContext.agentInstruction
    if (ctx.state && typeof ctx.state === 'object') {
      (ctx.state as Record<string, unknown>).systemInstruction =
        buildBaseInstruction() + '\n\n' + memoryBlock;
    }
  } catch (err) {
    // Log and continue — agent responds without memory context rather than erroring.
    console.error('[before_model_callback] Memory injection failed:', err);
  }
}

export const sessionService = new InMemorySessionService();

export const clankerAgent = new LlmAgent({
  name: 'clanker',
  model: 'gemini-1.5-flash',
  instruction: buildBaseInstruction(),
  tools: [
    searchMemoryTool,
    writeObservationTool,
    createTaskTool,
    listTasksTool,
    getCharacterProfileTool,
  ],
  // Replace key name if Task 2 found camelCase:
  before_model_callback: buildMemoryCallback,
});

export const runner = new Runner({
  appName: 'clanker-local',
  agent: clankerAgent,
  sessionService,
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd functions && npx tsc --noEmit
```

Expected: no errors. Fix every type error before moving on — type errors here will surface as runtime failures. If `LlmAgent` rejects the callback key, rename it. If `Runner` constructor shape differs, adjust.

- [ ] **Step 3: Commit**

```bash
git add functions/src/agent.ts
git commit -m "feat: add clanker LlmAgent with before_model_callback memory injection"
```

---

## Task 11: Main Entry Point

**Files:**
- Create: `functions/src/main.ts`

**Before writing:** Check `/tmp/adk-api-notes.txt` — does `@google/adk` have a programmatic `startDevServer` / `startWebServer` export, or is `adk web` CLI-only?

- [ ] **Step 1: Choose launch strategy and write `functions/src/main.ts`**

**Option A — if `@google/adk` exposes a programmatic web server start:**

```typescript
// Replace 'startDevServer' with the actual export name found in Task 2.
import { startDevServer } from '@google/adk/dev';
import { runner } from './agent.js';

const port = parseInt(process.env.PORT ?? '8080', 10);
const host = process.env.ADK_HOST ?? '0.0.0.0';

await startDevServer({ runner, port, host });
console.log(`Clanker agent running at http://${host}:${port}`);
```

**Option B — if `adk web` is CLI-only (spawn it as a child process):**

```typescript
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Import agent.ts to validate it loads without error on startup.
await import('./agent.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agentFile = path.join(__dirname, 'agent.js');

const port = process.env.PORT ?? '8080';
const host = process.env.ADK_HOST ?? '0.0.0.0';

const child = spawn(
  'npx',
  ['adk', 'web', agentFile, '--port', port, '--host', host],
  { stdio: 'inherit', env: process.env }
);

child.on('exit', (code) => process.exit(code ?? 0));
```

Write the option that matches your Task 2 findings.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd functions && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add functions/src/main.ts
git commit -m "feat: add main entry point for adk web"
```

---

## Task 12: Local Smoke Test (No Docker)

Run locally before Docker to catch module errors in a fast feedback loop.

- [ ] **Step 1: Set env vars**

```bash
export GOOGLE_API_KEY=your_actual_key_here
export SQLITE_PATH=file:/tmp/clanker_smoke.sqlite
export ADK_HOST=0.0.0.0
```

- [ ] **Step 2: Run the entry point**

```bash
cd functions && npx tsx src/main.ts
```

Expected: starts adk web on port 8080 (startup log appears). If it fails with `ERR_MODULE_NOT_FOUND`, the import path has a bug — check `.js` extensions on all imports.

- [ ] **Step 3: Verify the chat UI loads**

Open `http://localhost:8080` in browser. Expected: ADK chat UI loads with an input box.

- [ ] **Step 4: Send a test message**

Type: "Hello, who are you?"

Expected: Aria responds with something consistent with her traits (curious, helpful, direct). No stack traces in terminal.

- [ ] **Step 5: Stop and commit any fixes**

`Ctrl-C`

```bash
git add -p && git commit -m "fix: local smoke test issues"
```

---

## Task 13: Integration Test Suite

**Files:**
- Create: `functions/tests/suite.ts`

**Before writing:** Verify `wikiMemory.forget` signature from Task 2 notes. If `{ clearAll: true }` is unsupported, use the fallback teardown shown in Step 1.

- [ ] **Step 1: Confirm `wikiMemory.forget` teardown approach**

```bash
cd functions && node --input-type=module <<'EOF'
import { WikiMemory } from '@equationalapplications/core-llm-wiki';
console.log(WikiMemory.prototype.forget?.toString().slice(0, 300) ?? 'forget not found');
EOF
```

If `{ clearAll: true }` is not supported, use this teardown instead of the one in suite.ts:

```typescript
// Fallback teardown — call forget per fact id:
const existing = await wikiMemory.read(TEST_CHARACTER.id, '');
for (const fact of existing.facts ?? []) {
  await wikiMemory.forget(TEST_CHARACTER.id, fact.id);
}
```

- [ ] **Step 2: Write `functions/tests/suite.ts`**

Adjust `fact.body` to the correct property name from your Task 2 findings (might be `content` or `text`). Adjust `createTaskTool.execute` to the correct callable property name.

```typescript
import assert from 'node:assert/strict';
import { wikiMemory } from '../src/db/wiki.js';
import { createTaskTool } from '../src/tools/tasks.js';
import { tasks } from '../src/store/tasks.js';
import { buildBaseInstruction } from '../src/agent.js';
import { TEST_CHARACTER } from '../src/config/seed.js';

async function teardown(): Promise<void> {
  // Use { clearAll: true } if supported (confirmed in Step 1), else use the per-id fallback.
  await (wikiMemory as unknown as {
    forget: (id: string, opts: { clearAll: boolean }) => Promise<void>;
  }).forget(TEST_CHARACTER.id, { clearAll: true });
  tasks.delete(TEST_CHARACTER.id);
}

async function runTests(): Promise<void> {
  console.log('=== Clanker Integration Tests ===\n');

  await teardown();

  // --- Test 1: Memory Ingestion ---
  console.log('Test 1: Memory Ingestion...');
  await wikiMemory.write(TEST_CHARACTER.id, {
    event_type: 'observation',
    summary: "My dog's name is Buster",
  });
  // Explicit call — autoLibrarianThreshold won't fire on a single write, test must be deterministic.
  await wikiMemory.runLibrarian(TEST_CHARACTER.id);
  const memResult = await wikiMemory.read(TEST_CHARACTER.id, 'dog');
  assert(
    memResult.facts.some(
      (f: Record<string, unknown>) =>
        typeof f.body === 'string' && f.body.toLowerCase().includes('buster')
    ),
    'Expected memory to contain "buster" after librarian synthesis'
  );
  console.log('  PASS: Memory contains "buster"\n');

  // --- Test 2: Task Creation ---
  console.log('Test 2: Task Creation...');
  await createTaskTool.execute({
    description: 'Interview reminder',
    priority: 'high',
    due_context: null,
  });
  assert(
    tasks.get(TEST_CHARACTER.id)?.some((t) => t.description.toLowerCase().includes('interview')) === true,
    'Expected task store to contain "interview" task'
  );
  console.log('  PASS: Task "Interview reminder" in store\n');

  // --- Test 3: Character Context Injection ---
  console.log('Test 3: Character Context Injection...');
  const instruction = buildBaseInstruction();
  assert(
    instruction.includes(TEST_CHARACTER.name),
    `Expected instruction to include character name "${TEST_CHARACTER.name}"`
  );
  assert(
    instruction.includes(TEST_CHARACTER.traits),
    `Expected instruction to include character traits "${TEST_CHARACTER.traits}"`
  );
  console.log('  PASS: Instruction contains character name and traits\n');

  await teardown();
  console.log('=== All tests passed ===');
}

runTests().catch((err) => {
  console.error('\nTEST FAILED:', err.message ?? err);
  process.exit(1);
});
```

- [ ] **Step 3: Run the tests**

```bash
cd functions && GOOGLE_API_KEY=$GOOGLE_API_KEY SQLITE_PATH=file:/tmp/clanker_test.sqlite npm run test:integration
```

Expected output:
```
=== Clanker Integration Tests ===

Test 1: Memory Ingestion...
  PASS: Memory contains "buster"

Test 2: Task Creation...
  PASS: Task "Interview reminder" in store

Test 3: Character Context Injection...
  PASS: Instruction contains character name and traits

=== All tests passed ===
```

- [ ] **Step 4: Fix any failures**

Common failure modes:
- **Test 1 fails with "buster" not found:** `runLibrarian` method name may differ — check Task 2 notes. Also check `f.body` — may be `f.content` or `f.text`.
- **Test 1 fails with import error:** `wikiMemory.setup()` in `db/wiki.ts` is a top-level `await` in an ESM module — confirm the test runner imports ESM correctly via `--import tsx/esm`.
- **Test 2 fails:** `createTaskTool.execute` may be a different property name — check Task 2 ADK tool shape.
- **Test 3 fails:** `buildBaseInstruction` must be exported from `agent.ts` (it is, as written in Task 10).

- [ ] **Step 5: Commit**

```bash
git add functions/tests/suite.ts
git commit -m "feat: add integration test suite (memory ingestion, task creation, context injection)"
```

---

## Task 14: Docker Build and End-to-End Verification

**Files:** None new — validates Task 1 (Dockerfile.dev, docker-compose.yml).

- [ ] **Step 1: Build the Docker image**

From repo root:

```bash
GOOGLE_API_KEY=$GOOGLE_API_KEY docker compose build
```

Expected: build completes. Watch for `better-sqlite3` native compile output — the `python3 make g++` layer should complete without error. If native compile fails, ensure the `apk add` step in Dockerfile.dev ran before `npm ci`.

- [ ] **Step 2: Start the container**

```bash
GOOGLE_API_KEY=$GOOGLE_API_KEY docker compose up
```

Expected: startup log from main.ts (e.g. `Clanker agent running at http://0.0.0.0:8080` or ADK web output).

- [ ] **Step 3: Verify ADK UI is reachable**

Open `http://localhost:8080` in browser. Expected: ADK chat UI loads.

- [ ] **Step 4: Test memory write + persist across restart**

In the UI, type: "Remember that I love hiking."

Expected: Aria acknowledges and calls `write_observation` tool (visible in ADK tool call panel).

Restart the container:

```bash
docker compose restart
```

In UI: "What do you know about me?"

Note: `runLibrarian` runs on threshold. If memory hasn't been synthesized yet, force it:

```bash
docker compose exec agent npx tsx --input-type=module <<'EOF'
import { wikiMemory } from './src/db/wiki.js';
await wikiMemory.runLibrarian('test-char-001');
console.log('Librarian run complete');
EOF
```

Then ask again — Aria should recall hiking.

- [ ] **Step 5: Verify native bindings on Alpine**

```bash
docker compose exec agent node -e "require('better-sqlite3')"
```

Expected: no error. If you see `was compiled against a different Node.js version`:

```bash
docker compose exec agent npm rebuild better-sqlite3
```

This happens if the anonymous volume was populated on a different Node version. Rebuilding inside the container fixes it for the current session; a full `docker compose down -v && docker compose up --build` fixes it permanently.

- [ ] **Step 6: Commit any fixes**

```bash
git add -p && git commit -m "fix: docker build and runtime issues"
```

---

## Self-Review

### Spec Coverage

| Spec section | Plan task |
|---|---|
| §2.1 Container topology (1 container, bind mount, anon volume, named volume) | Task 1 |
| §2.2 Env vars (`GOOGLE_API_KEY`, `SQLITE_PATH`, `ADK_HOST`) | Task 1 (compose), Task 6 (guards) |
| §2.3 `docker-compose.yml` shape | Task 1 |
| §2.4 `Dockerfile.dev` shape | Task 1 |
| §3 File layout (exact paths) | All tasks; paths match spec exactly |
| §4.1 WikiMemory singleton + `better-sqlite3` + `GoogleGenAI` | Task 6 |
| §4.2 `LlmAgent` + `Runner` definition | Task 10 |
| §4.3 `search_memory` + `write_observation` tools | Task 8 |
| §4.4 `create_task` + `list_tasks` tools | Task 9 |
| §4.5 `before_model_callback` memory injection | Task 10 |
| §4.6 Session management (`ClankerMessage` map) | Task 5 |
| §4.7 Task pipeline separation (two distinct domains) | Tasks 4, 9 |
| §4.8 `TEST_CHARACTER` seed | Task 3 |
| §5 Error handling (callback catch+log, tool catch+string) | Tasks 8, 10 |
| §6 Test suite — Test 1 (memory ingestion) | Task 13 |
| §6 Test suite — Test 2 (task creation) | Task 13 |
| §6 Test suite — Test 3 (character context injection) | Task 13 |
| §6 Setup/teardown before/after each run | Task 13 |
| §7 Production migration path | Not implemented (PoC scope — no code needed) |
| §8 Gotcha: SQLite path targets named volume | Task 1 (compose env), Task 6 (path strip) |
| §8 Gotcha: anon volume for `node_modules` | Task 1 (compose) |
| §8 Gotcha: `ADK_HOST=0.0.0.0` | Task 1 (compose), Task 14 (verify) |
| §8 Gotcha: `lodash-es` ESM override | Task 1 (package.json overrides) |
| §8 Gotcha: explicit `runLibrarian()` in tests | Task 13 (explicit call + comment) |
| §8 Gotcha: test teardown mandatory | Task 13 (teardown before + after) |

### Type Consistency

- `AgentTask` → defined in `store/tasks.ts` (Task 4), imported in `tools/tasks.ts` (Task 9) and `tests/suite.ts` (Task 13) ✓
- `TEST_CHARACTER` → defined in `config/seed.ts` (Task 3), imported in `tools/character.ts` (Task 7), `tools/memory.ts` (Task 8), `tools/tasks.ts` (Task 9), `agent.ts` (Task 10), `tests/suite.ts` (Task 13) ✓
- `wikiMemory` → exported from `db/wiki.ts` (Task 6), imported in `tools/memory.ts` (Task 8), `agent.ts` (Task 10), `tests/suite.ts` (Task 13) ✓
- `tasks` Map → exported from `store/tasks.ts` (Task 4), imported in `tests/suite.ts` (Task 13) ✓
- `buildBaseInstruction` → exported from `agent.ts` (Task 10), called directly in `tests/suite.ts` Test 3 (Task 13) ✓
- `clankerAgent`, `runner`, `sessionService` → exported from `agent.ts` (Task 10), imported in `main.ts` (Task 11) ✓

### ADK API Uncertainty

Task 2 is a mandatory prerequisite for Tasks 7–11. Every ADK-specific file contains a note pointing back to Task 2 findings. If Task 2 is skipped, these files will compile but may fail at runtime with wrong method/property names.
