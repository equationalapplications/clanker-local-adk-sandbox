import Database from 'better-sqlite3';
import { WikiMemory, type SQLiteAdapter } from '@equationalapplications/core-llm-wiki';
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
const db = new Database(dbPath) as unknown as SQLiteAdapter;

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
      const embeddings = response.embeddings ?? [];
      return (embeddings[0]?.values ?? []) as number[];
    },
  },
});

await wikiMemory.setup();
