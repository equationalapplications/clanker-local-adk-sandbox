import { FunctionTool } from '@google/adk';
import { wikiMemory } from '../db/wiki.js';
import { TEST_CHARACTER } from '../config/seed.js';

export const searchMemoryTool = new FunctionTool({
  name: 'search_memory',
  description:
    "Search the character's long-term memory for facts relevant to a query. Call this when the user asks about past conversations, preferences, or anything the character might remember that was not already provided in the system context.",
  parameters: {
    type: 'object' as any,
    properties: {
      query: {
        type: 'string' as any,
        description: 'The search query to find relevant memories.',
      },
    },
    required: ['query'] as any,
  },
  execute: async (input: any): Promise<string> => {
    try {
      const query = input?.query ?? '';
      const result = await wikiMemory.read(TEST_CHARACTER.id, query);
      return JSON.stringify(result);
    } catch (err) {
      return `Memory search failed: ${String(err)}`;
    }
  },
});

export const writeObservationTool = new FunctionTool({
  name: 'write_observation',
  description:
    "Record a new observation about the user into long-term memory. Call this when the user shares a personal detail, preference, or fact that should be remembered across future conversations.",
  parameters: {
    type: 'object' as any,
    properties: {
      summary: {
        type: 'string' as any,
        description: 'The observation to record about the user.',
      },
    },
    required: ['summary'] as any,
  },
  execute: async (input: any): Promise<string> => {
    try {
      const summary = input?.summary ?? '';
      await wikiMemory.write(TEST_CHARACTER.id, { event_type: 'observation', summary });
      return 'Observation recorded.';
    } catch (err) {
      return `Failed to record observation: ${String(err)}`;
    }
  },
});
