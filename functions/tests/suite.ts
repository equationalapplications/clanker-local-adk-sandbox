import assert from 'node:assert/strict';
import { wikiMemory } from '../src/db/wiki.js';
import { createTaskTool } from '../src/tools/tasks.js';
import { tasks } from '../src/store/tasks.js';
import { buildBaseInstruction } from '../src/agent.js';
import { TEST_CHARACTER } from '../src/config/seed.js';

async function teardown(): Promise<void> {
  // Use { clearAll: true } as confirmed in API findings
  await wikiMemory.forget(TEST_CHARACTER.id, { clearAll: true });
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
  // Explicit call — autoLibrarianThreshold won't fire on a single write
  await wikiMemory.runLibrarian(TEST_CHARACTER.id);
  const memResult = await wikiMemory.read(TEST_CHARACTER.id, 'dog');
  assert(
    memResult.facts.some(
      (f: any) =>
        typeof f.body === 'string' && f.body.toLowerCase().includes('buster')
    ),
    'Expected memory to contain "buster" after librarian synthesis'
  );
  console.log('  PASS: Memory contains "buster"\n');

  // --- Test 2: Task Creation ---
  console.log('Test 2: Task Creation...');
  await (createTaskTool as any).execute({
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
