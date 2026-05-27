# ADK and WikiMemory API Findings

## ADK API Shapes

- **LlmAgent callback param name:** `beforeModelCallback` (camelCase, not snake_case)
- **Callback context type:** `CallbackContext` from `@google/adk`
- **Callback signature:** `({ callbackContext, llmRequest }) => void | Promise<void>`
- **ADK tool callable property:** `execute` (not `handler` or `function`)
- **ADK tool schema property:** `parameters` (standard JSON Schema)
- **Runner constructor:** `new Runner({ appName, agent, sessionService })`
- **SessionService:** `InMemorySessionService` available
- **adk web:** CLI-only (no programmatic API found) - will need to spawn child process

## WikiMemory API Shapes

- **Import:** `import { WikiMemory } from '@equationalapplications/core-llm-wiki'`
- **Constructor:** `new WikiMemory(db, options)` where options includes `llmProvider`
- **wikiMemory.forget clearAll support:** YES - `{ clearAll: true }` is supported
- **wikiMemory.read result fact text property:** `body` (not `content` or `text`)
- **wikiMemory.runLibrarian method name:** `runLibrarian(entityId, options?)`
- **wikiMemory.setup():** Returns `Promise<void>`
- **wikiMemory.write(entityId, event):** Returns `Promise<void>`
- **read() returns:** `MemoryBundle` with `{ facts: WikiFact[], tasks: WikiTask[], events: WikiEvent[] }`
- **WikiFact properties:** `id, entity_id, title, body, tags, confidence, source_type`

## LLM Provider Shape for WikiMemory

```typescript
{
  generateText: async ({ systemPrompt, userPrompt }): Promise<string> => { ... },
  embed: async (text: string): Promise<number[]> => { ... }
}
```

## GoogleGenAI API

- **Import:** `import { GoogleGenAI } from '@google/genai'`
- **Constructor:** `new GoogleGenAI({ apiKey })`
- **Generate content:** `ai.models.generateContent({ model, contents })`
- **Embed content:** `ai.models.embedContent({ model, contents })`

## Key Differences from Spec

1. `before_model_callback` → `beforeModelCallback` (camelCase)
2. Tool `execute` property (not handler)
3. Fact text property is `body` (not `content` or `text`)
4. `adk web` is CLI-only - need to spawn child process in main.ts
5. `@google/adk` uses `InMemoryRunner` as an alternative to `Runner`
