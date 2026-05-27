export type ClankerMessage = {
  _id: string;
  text: string;
  createdAt: Date;
  user: { _id: string; name: string };
};

export const sessions = new Map<string, ClankerMessage[]>();

export function getSession(sessionId: string): ClankerMessage[] {
  return sessions.get(sessionId) ?? [];
}

export function appendMessage(sessionId: string, message: ClankerMessage): void {
  const existing = sessions.get(sessionId) ?? [];
  sessions.set(sessionId, [...existing, message]);
}
