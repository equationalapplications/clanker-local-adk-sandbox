import { FunctionTool } from '@google/adk';
import { addTask, getTasks } from '../store/tasks.js';
import { TEST_CHARACTER } from '../config/seed.js';
import type { AgentTask } from '../store/tasks.js';

export const createTaskTool = new FunctionTool({
  name: 'create_task',
  description:
    'Create a task or reminder for the user. Call this only when the user explicitly asks you to track, remind, or remember to do something actionable.',
  parameters: {
    type: 'object' as any,
    properties: {
      description: {
        type: 'string' as any,
        description: 'The task description.',
      },
      priority: {
        type: 'string' as any,
        enum: ['low', 'medium', 'high'],
        description: 'Task priority level.',
      },
      due_context: {
        type: 'string' as any,
        description: 'Optional natural-language due date or context (e.g. "tomorrow", "end of week").',
      },
    },
    required: ['description'] as any,
  },
  execute: async (input: any): Promise<string> => {
    const description = input?.description ?? '';
    const priority = input?.priority ?? 'medium';
    const due_context = input?.due_context ?? null;
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
});

export const listTasksTool = new FunctionTool({
  name: 'list_tasks',
  description: "List the user's pending tasks and reminders.",
  parameters: {
    type: 'object' as any,
    properties: {} as any,
    required: [] as any,
  },
  execute: async (): Promise<string> => {
    const userTasks = getTasks(TEST_CHARACTER.id).filter((t) => t.status === 'pending');
    if (userTasks.length === 0) return 'No pending tasks.';
    return JSON.stringify(userTasks);
  },
});
