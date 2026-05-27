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
const db = new Database(dbPath);

// Adapter to make better-sqlite3 compatible with SQLiteAdapter interface
const dbAdapter: SQLiteAdapter = {
  execAsync(sql: string): Promise<void> {
    return Promise.resolve(db.exec(sql) as void);
  },
  runAsync(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowId: number }> {
    const stmt = db.prepare(sql);
    const result = stmt.run(params ?? []);
    return Promise.resolve({ changes: result.changes, lastInsertRowId: result.lastInsertRowid });
  },
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const stmt = db.prepare(sql);
    const rows = stmt.all(params ?? []) as T[];
    return Promise.resolve(rows);
  },
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null> {
    const stmt = db.prepare(sql);
    const row = stmt.get(params ?? []) as T | undefined;
    return Promise.resolve(row ?? null);
  },
  withTransactionAsync<T>(fn: (tx: SQLiteAdapter) => Promise<T>): Promise<T> {
    return db.transaction(async () => {
      const txAdapter: SQLiteAdapter = {
        execAsync(sql: string): Promise<void> {
          return Promise.resolve(db.exec(sql) as void);
        },
        runAsync(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowId: number }> {
          const stmt = db.prepare(sql);
          const result = stmt.run(params ?? []);
          return Promise.resolve({ changes: result.changes, lastInsertRowId: result.lastInsertRowid });
        },
        getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]> {
          const stmt = db.prepare(sql);
          const rows = stmt.all(params ?? []) as T[];
          return Promise.resolve(rows);
        },
        getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null> {
          const stmt = db.prepare(sql);
          const row = stmt.get(params ?? []) as T | undefined;
          return Promise.resolve(row ?? null);
        },
        withTransactionAsync<T>(fn: (tx: SQLiteAdapter) => Promise<T>): Promise<T> {
          return Promise.reject(new Error('Nested transactions not supported'));
        },
        closeAsync(): Promise<void> {
          return Promise.resolve(db.close());
        },
      };
      return await fn(txAdapter);
    })();
  },
  closeAsync(): Promise<void> {
    return Promise.resolve(db.close());
  },
};

export const wikiMemory = new WikiMemory(dbAdapter, {
  llmProvider: {
    generateText: async ({
      systemPrompt,
      userPrompt,
    }: {
      systemPrompt: string;
      userPrompt: string;
    }): Promise<string> => {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `${systemPrompt}\n\n${userPrompt}`,
      });
      return response.text ?? '';
    },
    embed: async (text: string): Promise<number[]> => {
      const response = await ai.models.embedContent({
        model: 'gemini-embedding-001',
        contents: text,
      });
      const embeddings = response.embeddings ?? [];
      return (embeddings[0]?.values ?? []) as number[];
    },
  },
});

await wikiMemory.setup();
