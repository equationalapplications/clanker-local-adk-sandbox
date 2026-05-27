# Clanker Local ADK Sandbox

A local, single-container Proof of Concept (PoC) for the Clanker AI agent. This sandbox allows for rapid iteration on agent logic, tool boundaries, and semantic memory without incurring Google Cloud Platform (GCP) compute costs.

It faithfully mirrors the eventual Cloud Run production architecture, substituting Cloud SQL for a local SQLite volume and Vertex AI for Google AI Studio credentials.

## 🏗 Architecture

* **Framework:** Google Agent Development Kit (`@google/adk`)
* **Memory Engine:** `@equationalapplications/core-llm-wiki`
* **Database:** `better-sqlite3` (Mocking Cloud SQL)
* **LLM Provider:** Gemini 1.5 Flash / Text-Embedding-004 (via AI Studio)
* **Infrastructure:** Single Docker Container (Node 22 Debian slim) with `AdkApiServer`

---

## 🚀 Quick Start

### 1. Prerequisites

* [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running.
* A free **Google AI Studio API Key** (Do not use GCP Service Accounts for this local dev environment).

### 2. Environment Setup

Create a `.env` file in the root of the project (alongside `docker-compose.yml`):

```bash
GOOGLE_API_KEY=your_ai_studio_api_key_here

```

*Note: `SQLITE_PATH` and `ADK_HOST` are managed automatically by the `docker-compose.yml` file.*

### 3. Build and Run

Start the container with hot-reloading enabled:

```bash
docker compose build && docker compose down && docker compose up

```

> **Note:** Always run `docker compose down` before `docker compose up` after a rebuild. Without it, Docker reuses the existing container from the old image and the rebuild has no effect.

Once the container is running, open **[http://localhost:8080](https://www.google.com/search?q=http://localhost:8080)** in your browser to access the ADK web chat interface.

---

## 🧪 Testing

The sandbox includes a direct-to-database integration test suite that bypasses the HTTP layer to assert state mutations natively.

To run the integration suite inside the running container:

```bash
docker compose exec agent npm run test:integration

```

**Test Cases Covered:**

1. **Memory Ingestion:** Asserts that `write()` and `runLibrarian()` successfully synthesize vector facts.
2. **Task Creation:** Asserts that the `create_task` ADK tool correctly mutates the in-memory user task map.
3. **Context Injection:** Asserts that the `before_model_callback` accurately hydrates the LLM system prompt with character traits and memory.

---

## 📂 Project Structure

```text
.
├── docker-compose.yml
├── .env                  
└── functions/
    ├── Dockerfile.dev
    ├── package.json
    ├── tsconfig.json
    ├── tests/
    │   └── suite.ts              # Integration test runner
    └── src/
        ├── main.ts               # Entry point (starts AdkApiServer)
        ├── agent.ts              # LlmAgent & Runner definitions
        ├── session.ts            # Transient chat state map
        ├── config/
        │   └── seed.ts           # TEST_CHARACTER definitions
        ├── db/
        │   └── wiki.ts           # WikiMemory singleton (SQLite)
        ├── store/
        │   └── tasks.ts          # Explicit User Tasks map
        └── tools/
            ├── character.ts      # get_character_profile
            ├── memory.ts         # search_memory & write_observation
            └── tasks.ts          # create_task & list_tasks

```

---

## 🧠 Design Principles

### The Memory Boundary (Hybrid Approach)

The agent uses a hybrid memory architecture to prevent "lazy LLM syndrome":

* **Implicit (Zero-Latency):** A `before_model_callback` silently queries `WikiMemory` on every turn and injects the top semantic facts directly into the system prompt.
* **Explicit (Deep-Dive):** The `search_memory` tool is available for the agent to call manually if the conversation shifts context abruptly.

### The Task Boundary (Dual Pipelines)

To prevent internal character directives from bleeding into the user's to-do list, tasks are strictly separated:

* **Wiki Tasks (Internal):** Generated autonomously by the background Librarian. Stored in SQLite. Surfaced *only* in the system prompt as "Internal Directives".
* **User Tasks (Explicit):** Created only when the agent calls `create_task`. Stored in the `store/tasks.ts` Map (eventually Cloud SQL).

---

## ⚠️ Troubleshooting & Known Gotchas

**1. "Module compiled against a different Node.js version" (better-sqlite3)**
Because your host machine bind-mounts `./functions` to `/app`, macOS/Windows binaries can accidentally overwrite the Alpine Linux container binaries.

* **Fix:** Run `docker compose exec agent npm rebuild better-sqlite3`

**2. ADK API Server is unreachable on localhost:8080**
Ensure `ADK_HOST=0.0.0.0` is passed to the container. The `AdkApiServer` must bind to `0.0.0.0` (not `127.0.0.1`) for Docker port forwarding to work.

**3. `SyntaxError: The requested module 'lodash-es' does not provide an export named 'isEmpty'`**
`@google/adk-devtools@1.1.x` ships an internal npm override that aliases `lodash-es` to CJS `lodash`. The ESM build then fails to import named exports.

* **Fix:** Already patched in `Dockerfile.dev` — the build installs real `lodash-es@4.17.21` in an isolated temp directory and replaces all aliased copies. No action required unless you see this after clearing the Docker cache.

**4. Integration Test 1 fails to find a memory fact**
`WikiMemory.write()` drops an *Event*, not a *Fact*. Facts are only generated when `runLibrarian()` executes. Ensure the test suite explicitly calls `await wikiMemory.runLibrarian()` before asserting the read, overriding the default batch threshold.

---

## ☁️ Path to Production (Cloud Run)

When migrating this codebase to the production Cloud Run environment:

1. Swap the `GOOGLE_API_KEY` for GCP Vertex AI credentials (`GOOGLE_APPLICATION_CREDENTIALS`).
2. Swap `better-sqlite3` for the `@google-cloud/cloud-sql-connector` and PostgreSQL driver.
3. Replace the `Map` stores in `session.ts` and `store/tasks.ts` with Drizzle ORM queries to your Cloud SQL instance.