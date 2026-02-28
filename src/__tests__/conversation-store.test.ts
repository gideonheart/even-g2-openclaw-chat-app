import 'fake-indexeddb/auto';
import { openDB, closeDB, DB_NAME } from '../persistence/db';
import {
  createConversationStore,
  generateConversationName,
} from '../persistence/conversation-store';
import type { ConversationStore } from '../persistence/types';

describe('conversation-store', () => {
  let db: IDBDatabase;
  let store: ConversationStore;

  beforeEach(async () => {
    db = await openDB();
    store = createConversationStore(db);
  });

  afterEach(() => {
    closeDB(db);
    indexedDB.deleteDatabase(DB_NAME);
  });

  // ── Conversation CRUD ────────────────────────────────────

  describe('createConversation', () => {
    it('creates a conversation with auto-generated id, createdAt, updatedAt', async () => {
      const conv = await store.createConversation();
      expect(conv.id).toBeDefined();
      expect(typeof conv.id).toBe('string');
      expect(conv.id.length).toBeGreaterThan(0);
      expect(conv.createdAt).toBeGreaterThan(0);
      expect(conv.updatedAt).toBeGreaterThan(0);
      expect(conv.createdAt).toBe(conv.updatedAt);
    });

    it('uses provided name', async () => {
      const conv = await store.createConversation('My Chat');
      expect(conv.name).toBe('My Chat');
    });

    it('defaults to "New conversation" without name', async () => {
      const conv = await store.createConversation();
      expect(conv.name).toBe('New conversation');
    });
  });

  describe('getConversation', () => {
    it('returns the conversation by id', async () => {
      const created = await store.createConversation('Test');
      const fetched = await store.getConversation(created.id);
      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.name).toBe('Test');
    });

    it('returns undefined for nonexistent id', async () => {
      const result = await store.getConversation('nonexistent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('updateConversation', () => {
    it('updates name and updatedAt', async () => {
      const created = await store.createConversation('Original');
      // Small delay to ensure updatedAt changes
      await new Promise((r) => setTimeout(r, 10));
      const updated = await store.updateConversation(created.id, {
        name: 'Renamed',
      });
      expect(updated.name).toBe('Renamed');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
    });
  });

  describe('getAllConversations', () => {
    it('returns all conversations sorted by updatedAt descending', async () => {
      const a = await store.createConversation('A');
      await new Promise((r) => setTimeout(r, 10));
      const b = await store.createConversation('B');
      await new Promise((r) => setTimeout(r, 10));
      // Update A to make it most recent
      await store.updateConversation(a.id, { name: 'A updated' });

      const all = await store.getAllConversations();
      expect(all).toHaveLength(2);
      expect(all[0].name).toBe('A updated');
      expect(all[1].name).toBe('B');
    });
  });

  describe('getLastConversation', () => {
    it('returns the most recently updated conversation', async () => {
      await store.createConversation('First');
      await new Promise((r) => setTimeout(r, 10));
      const second = await store.createConversation('Second');

      const last = await store.getLastConversation();
      expect(last).toBeDefined();
      expect(last!.id).toBe(second.id);
      expect(last!.name).toBe('Second');
    });

    it('returns undefined when no conversations exist', async () => {
      const last = await store.getLastConversation();
      expect(last).toBeUndefined();
    });
  });

  // ── Message CRUD ─────────────────────────────────────────

  describe('addMessage', () => {
    it('stores message with generated id', async () => {
      const conv = await store.createConversation('Test');
      const msgId = await store.addMessage(conv.id, {
        role: 'user',
        text: 'Hello',
        timestamp: Date.now(),
      });
      expect(typeof msgId).toBe('string');
      expect(msgId.length).toBeGreaterThan(0);
    });

    it('updates conversation updatedAt timestamp', async () => {
      const conv = await store.createConversation('Test');
      await new Promise((r) => setTimeout(r, 10));
      await store.addMessage(conv.id, {
        role: 'user',
        text: 'Hello',
        timestamp: Date.now(),
      });

      const updated = await store.getConversation(conv.id);
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(conv.updatedAt);
    });
  });

  describe('getMessages', () => {
    it('returns all messages for a conversation sorted by timestamp', async () => {
      const conv = await store.createConversation('Test');
      const t1 = Date.now();
      await store.addMessage(conv.id, {
        role: 'user',
        text: 'First',
        timestamp: t1,
      });
      await store.addMessage(conv.id, {
        role: 'assistant',
        text: 'Second',
        timestamp: t1 + 100,
      });
      await store.addMessage(conv.id, {
        role: 'user',
        text: 'Third',
        timestamp: t1 + 200,
      });

      const messages = await store.getMessages(conv.id);
      expect(messages).toHaveLength(3);
      expect(messages[0].text).toBe('First');
      expect(messages[1].text).toBe('Second');
      expect(messages[2].text).toBe('Third');
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
    });

    it('returns empty array for unknown conversation', async () => {
      const messages = await store.getMessages('unknown-id');
      expect(messages).toEqual([]);
    });
  });
});

// ── Auto-naming ──────────────────────────────────────────

describe('generateConversationName', () => {
  it('returns short message unchanged', () => {
    expect(generateConversationName('Hello')).toBe('Hello');
  });

  it('truncates at ~50 chars at word boundary with "..."', () => {
    const input =
      'What is the meaning of life and why does it matter to philosophers';
    const name = generateConversationName(input);
    expect(name.length).toBeLessThanOrEqual(54); // 50 + "..."
    expect(name.endsWith('...')).toBe(true);
    // Should truncate at a word boundary (space before the truncation point)
    const withoutEllipsis = name.slice(0, -3);
    // The truncated part should end at a complete word
    expect(input.startsWith(withoutEllipsis)).toBe(true);
    // Verify it broke at a space in the original (next char is space or end)
    const nextCharInOriginal = input[withoutEllipsis.length];
    expect(nextCharInOriginal === ' ' || nextCharInOriginal === undefined).toBe(true);
  });

  it('truncates at 50 chars if no word boundary found after char 20', () => {
    const input = 'Superlongwordwithoutanyspacesatallwhichmakesitimpossibletofindawordbreak';
    const name = generateConversationName(input);
    expect(name.length).toBe(53); // 50 + "..."
    expect(name.endsWith('...')).toBe(true);
  });

  it('returns "New conversation" for empty input', () => {
    expect(generateConversationName('')).toBe('New conversation');
  });
});
