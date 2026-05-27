import { FunctionTool } from '@google/adk';
import { TEST_CHARACTER } from '../config/seed.js';

export const getCharacterProfileTool = new FunctionTool({
  name: 'get_character_profile',
  description:
    'Get the current character profile including name, traits, and context. Call this when you need to recall who you are or confirm your character attributes.',
  parameters: {
    type: 'object' as any,
    properties: {},
    required: [] as any,
  },
  execute: async (): Promise<string> => {
    return JSON.stringify({
      id: TEST_CHARACTER.id,
      name: TEST_CHARACTER.name,
      traits: TEST_CHARACTER.traits,
      context: TEST_CHARACTER.context,
    });
  },
});
