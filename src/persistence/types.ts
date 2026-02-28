// ── Persistence types ──────────────────────────────────────

export interface ConversationRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

export interface SearchResult {
  messageId: string;
  conversationId: string;
  conversationName: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  snippet: { before: string; match: string; after: string };
}

export interface ConversationStore {
  createConversation(name?: string): Promise<ConversationRecord>;
  getConversation(id: string): Promise<ConversationRecord | undefined>;
  updateConversation(
    id: string,
    updates: Partial<Pick<ConversationRecord, 'name'>>,
  ): Promise<ConversationRecord>;
  getAllConversations(): Promise<ConversationRecord[]>;
  addMessage(
    conversationId: string,
    msg: { role: 'user' | 'assistant'; text: string; timestamp: number },
  ): Promise<string>;
  getMessages(conversationId: string): Promise<MessageRecord[]>;
  getMessage(messageId: string): Promise<MessageRecord | undefined>;
  verifyMessage(messageId: string): Promise<boolean>;
  getLastConversation(): Promise<ConversationRecord | undefined>;
  searchMessages(query: string, limit?: number): Promise<SearchResult[]>;
  countMessages(conversationId: string): Promise<number>;
}

export interface SessionStore {
  createSession(name?: string): Promise<ConversationRecord>;
  renameSession(id: string, name: string): Promise<ConversationRecord>;
  deleteSession(id: string): Promise<void>;
  listSessions(): Promise<ConversationRecord[]>;
  getSession(id: string): Promise<ConversationRecord | undefined>;
  getActiveSessionId(): string | null;
  setActiveSessionId(id: string): void;
}
