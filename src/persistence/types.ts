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
  getLastConversation(): Promise<ConversationRecord | undefined>;
}
