# Local ADK Agent Sandbox — Design Spec

**Date:** 2026-05-27  
**Status:** Approved  
**Scope:** Local Docker PoC for iterating on the Clanker agent before Cloud Run integration

---

## 1. Goal

Build a single-container local sandbox that lets you iterate on the Clanker agent logic—ADK tools, memory, session management—with hot-reload and zero GCP billing. The sandbox must faithfully mirror the eventual Cloud Run architecture so the transition to production is a config swap, not a rewrite.

---

## 2. Architecture

### 2.1 Container Topology

One Docker container. One process.

```
docker-compose.yml
└── agent (node:22-alpine)
    ├── port 8080  →  AdkApiServer (browser chat UI)
    ├── bind mount: ./functions:/app  (hot-reload via tsx watch)
    ├── anon volume: /app/node_modules  (protects Alpine native bindings)
    └── named volume: wikidata:/data   (SQLite persistence)
```

No database container. `@equationalapplications/core-llm-wiki` runs on `better-sqlite3` natively. The PostgreSQL container from the original blueprint is intentionally omitted — it is not required until Cloud SQL sync is wired in production.

### 2.2 Environment Variables

| Variable | Purpose |
|---|---|
| `GOOGLE_API_KEY` | Google AI Studio key — used by ADK agent + WikiMemory llmProvider |
| `SQLITE_PATH` | `file:/data/local_dev.sqlite` — must target the named volume, not the bind mount |
| `ADK_HOST` | `0.0.0.0` — required for `AdkApiServer` to be reachable from the host via port mapping |

`GOOGLE_API_KEY` replaces the original OpenRouter requirement. ADK is built around Gemini; using a Google AI Studio key for local dev avoids mounting GCP service account JSON. Swap to Vertex credentials (`GOOGLE_APPLICATION_CREDENTIALS`) for Cloud Run deploy.

### 2.3 `docker-compose.yml` Shape

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

### 2.4 `Dockerfile.dev` Shape

```dockerfile
FROM node:22-alpine
RUN apk add --no-cache python3 make g++  # required for better-sqlite3
WORKDIR /app
COPY package*.json ./
RUN npm ci
EXPOSE 8080
CMD ["npx", "tsx", "watch", "src/main.ts"]
```

---

## 3. File Layout

```
functions/
├── src/
│   ├── main.ts               # entry point — starts AdkApiServer
│   ├── agent.ts              # LlmAgent definition
│   ├── tools/
│   │   ├── memory.ts         # search_memory, write_observation
│   │   ├── tasks.ts          # create_task, list_tasks
│   │   └── character.ts      # get_character_profile
│   ├── db/
│   │   └── wiki.ts           # WikiMemory singleton + better-sqlite3 adapter
│   ├── session.ts            # in-memory ClankerMessage map
│   ├── store/
│   │   └── tasks.ts          # in-memory AgentTask map
│   └── config/
│       └── seed.ts           # TEST_CHARACTER definition
├── tests/
│   └── suite.ts              # integration test runner
├── Dockerfile.dev
└── package.json
```

---

## 4. Components

### 4.1 WikiMemory Singleton (`db/wiki.ts`)

```typescript
import Database from 'better-sqlite3';
import { WikiMemory } from '@equationalapplications/core-llm-wiki';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

const db = new Database(process.env.SQLITE_PATH!.replace('file:', ''));

export const wikiMemory = new WikiMemory(db, {
  llmProvider: {
    generateText: async ({ systemPrompt, userPrompt }) => {
      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: `${systemPrompt}\n\n${userPrompt}`,
      });
      return response.text;
    },
    embed: async (text: string) => {
      const response = await ai.models.embedContent({
        model: 'text-embedding-004',
        contents: text,
      });
      return response.embeddings[0].values;
    },
  },
});

await wikiMemory.setup();
```

### 4.2 ADK Agent (`agent.ts`)

> **Note:** Code below shows design intent. Exact `@google/adk` Node.js constructor shapes and callback hook names must be verified against the installed package version during implementation.

```typescript
import { LlmAgent, Runner } from '@google/adk';
import { searchMemoryTool, writeObservationTool } from './tools/memory';
import { createTaskTool, listTasksTool } from './tools/tasks';
import { getCharacterProfileTool } from './tools/character';

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
  before_model_callback: buildMemoryCallback(), // verify hook name in @google/adk Node.js API
});

export const runner = new Runner({
  appName: 'clanker-local',
  agent: clankerAgent,
});
```

### 4.3 Memory Tools (`tools/memory.ts`)

Two tools with explicit descriptions that guide the LLM on when to call each:

**`search_memory`**  
Description: *"Search the character's long-term memory for facts relevant to a query. Call this when the user asks about past conversations, preferences, or anything the character might remember that was not already provided in the system context."*  
Implementation: `wikiMemory.read(characterId, query)` — returns facts ranked by semantic similarity.

**`write_observation`**  
Description: *"Record a new observation about the user into long-term memory. Call this when the user shares a personal detail, preference, or fact that should be remembered across future conversations."*  
Implementation: `wikiMemory.write(characterId, { event_type: 'observation', summary })` — drops an event; WikiMemory's librarian synthesizes facts asynchronously. The agent never calls `runLibrarian()` directly.

### 4.4 Task Tools (`tools/tasks.ts`)

**`create_task`**  
Description: *"Create a task or reminder for the user. Call this only when the user explicitly asks you to track, remind, or remember to do something actionable."*  
Implementation: Appends to `Map<characterId, AgentTask[]>` in `store/tasks.ts`. Mirrors clanker `agent_tasks` schema fields: `id`, `description`, `status`, `priority`, `due_context`, `created_at`.

**`list_tasks`**  
Description: *"List the user's pending tasks and reminders."*  
Implementation: Returns tasks from the in-memory map for `characterId`. Does not read WikiMemory's internal task store.

### 4.5 `before_model_callback`

Fires on every turn before the model is called. Runs `wikiMemory.read(characterId, userMessage)` silently and injects into the **system instruction** (not the user message — appending to user message causes the LLM to attribute the memory context to the user):

```
[Memory Context]
Relevant Facts:
{{wiki_facts}}

My Internal Directives (Do not show these to the user):
{{wiki_tasks}}

The User's Pending To-Do List:
{{store_tasks}}
[End Memory Context]
```

- `wiki_facts` — facts from `wikiMemory.read()` result
- `wiki_tasks` — tasks from `wikiMemory.read()` result (WikiMemory-internal, generated by librarian)
- `store_tasks` — tasks from `store/tasks.ts` map (user-requested, created via `create_task` tool)

On failure, log and continue — agent responds without memory context rather than erroring.

### 4.6 Session Management (`session.ts`)

```typescript
type ClankerMessage = {
  _id: string;
  text: string;
  createdAt: Date;
  user: { _id: string; name: string };
};

const sessions = new Map<string, ClankerMessage[]>();
```

ADK's `InMemorySessionService` is used as a single-turn scratchpad only. On each turn, the `ClankerMessage[]` array is converted to ADK's content format and passed to `runner.run()`. ADK session state is rebuilt from this map every turn — ADK does not own the source of truth.

This boundary ensures that swapping `Map` for a Drizzle query to Cloud SQL `messages` table requires changing only `session.ts`, with no ADK coupling.

### 4.7 Task Pipeline Separation

Two completely separate domains — they never merge:

| Domain | Storage | Creator | Consumer |
|---|---|---|---|
| Internal agent tasks | SQLite (WikiMemory tables) | `runLibrarian()` background synthesis | `before_model_callback` injects as "Internal Directives" |
| User tasks | In-memory `Map` (→ Cloud SQL `agent_tasks` in prod) | `create_task` ADK tool | `list_tasks` ADK tool + `before_model_callback` |

Internal tasks are the character's private conversational goals. User tasks are explicit to-dos managed for the user. The LLM is instructed not to surface internal directives in responses.

### 4.8 Seed Character (`config/seed.ts`)

```typescript
export const TEST_CHARACTER = {
  id: 'test-char-001',
  name: 'Aria',
  traits: 'curious, helpful, direct',
  context: 'Personal assistant for development testing',
};
```

Single hardcoded character for PoC. No character management UI needed. Replace with Drizzle query to Cloud SQL `characters` table in production.

---

## 5. Error Handling

| Failure | Behavior |
|---|---|
| `before_model_callback` WikiMemory read fails | Catch, log, continue without memory context |
| ADK tool throws | Tool returns structured error string to agent; agent handles in natural language |
| `better-sqlite3` native binding mismatch | `docker compose exec agent npm rebuild better-sqlite3` |
| `@google/adk` `lodash-es` ESM quirk | Add `"overrides": { "lodash-es": "lodash" }` to `package.json` |
| ADK API Server not reachable from host | Ensure `ADK_HOST=0.0.0.0` is set; `AdkApiServer` must bind to `0.0.0.0` not `127.0.0.1` |

---

## 6. Test Suite (`tests/suite.ts`)

Run via `npm run test:integration`. Results to stdout. No HTTP round-trips — tests call module functions directly against the live SQLite file.

### Setup / Teardown (runs before and after each suite run)

```typescript
// Verify exact wikiMemory.forget() signature against @equationalapplications/core-llm-wiki source
// before implementation — the { clearAll: true } variant is not shown in the README.
// Fallback: call forget() per-fact-id, or use runPrune() after soft-deleting all facts.
await wikiMemory.forget(TEST_CHARACTER.id, { clearAll: true });
tasks.delete(TEST_CHARACTER.id);
```

Ensures a clean slate on every run. Prevents duplicate facts and tasks accumulating across runs.

### Test 1 — Memory Ingestion

```
Action:  await wikiMemory.write(TEST_CHARACTER.id, { event_type: 'observation', summary: "My dog's name is Buster" })
         await wikiMemory.runLibrarian(TEST_CHARACTER.id)   // explicit call; don't rely on autoLibrarianThreshold
Assert:  result = await wikiMemory.read(TEST_CHARACTER.id, 'dog')
         result.facts.some(f => f.body.toLowerCase().includes('buster')) === true
```

**Why explicit `runLibrarian()`:** `write()` inserts an Event, not a Fact. Facts are synthesized only when the librarian runs. Default `autoLibrarianThreshold` is 20 — a single test write would never trigger it. Calling `runLibrarian()` explicitly makes the test deterministic.

### Test 2 — Task Creation

```
Action:  invoke create_task tool handler directly with { description: 'Interview reminder', characterId: TEST_CHARACTER.id }
Assert:  tasks.get(TEST_CHARACTER.id)?.some(t => t.description.toLowerCase().includes('interview')) === true
```

### Test 3 — Character Context Injection

```
Action:  run before_model_callback for TEST_CHARACTER with empty message history
Assert:  injected system instruction string contains TEST_CHARACTER.name ('Aria')
         injected system instruction string contains TEST_CHARACTER.traits ('curious, helpful, direct')
```

---

## 7. Production Migration Path

When integrating into Cloud Run:

| PoC component | Production replacement |
|---|---|
| `GOOGLE_API_KEY` (AI Studio) | `GOOGLE_APPLICATION_CREDENTIALS` (Vertex AI service account) |
| `better-sqlite3` + SQLite file | `@google-cloud/cloud-sql-connector` + Drizzle + PostgreSQL |
| `Map<sessionId, ClankerMessage[]>` | Drizzle query to Cloud SQL `messages` table |
| `Map<characterId, AgentTask[]>` | Drizzle query to Cloud SQL `agent_tasks` table |
| `config/seed.ts` TEST_CHARACTER | Drizzle query to Cloud SQL `characters` table |
| AdkApiServer | Firebase callable or Cloud Run HTTP endpoint |

WikiMemory's `llmProvider` shape (`generateText`, `embed`) is identical between AI Studio and Vertex — only the credentials change.

---

## 8. Known Gotchas

1. **SQLite path must target named volume:** `SQLITE_PATH=file:/data/local_dev.sqlite`. A relative path like `./local_dev.sqlite` writes to the bind mount and is lost when the volume is unmounted.
2. **`node_modules` anonymous volume required:** The bind mount of `./functions:/app` overwrites the container's `node_modules` with macOS-compiled binaries, breaking `better-sqlite3` native bindings on Alpine. The `/app/node_modules` anonymous volume shadows this.
3. **`AdkApiServer` must bind to `0.0.0.0`:** Default binds to `127.0.0.1`. The Docker port mapping is inert unless the server listens on all interfaces.
4. **`lodash-es` ESM conflict in `@google/adk`:** Current npm package ships a CommonJS build with an `lodash-es` ESM dependency. Fix: `"overrides": { "lodash-es": "lodash" }` in `package.json`.
5. **Test 1 requires explicit `runLibrarian()`:** `write()` inserts events, not facts. Facts only exist after librarian synthesis. Do not rely on `autoLibrarianThreshold` in tests.
6. **Test teardown is mandatory:** Tests run against live SQLite + in-memory maps. Without teardown, repeated runs accumulate duplicate state and produce false positives.
