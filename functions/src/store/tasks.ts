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
