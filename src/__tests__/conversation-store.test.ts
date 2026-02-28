import 'fake-indexeddb/auto';
import { openDB, closeDB, DB_NAME } from '../persistence/db';
import {
  createConversationStore,
  generateConversationName,
  extractSnippet,
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
      await store.createConversation('B');
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
  // ── Search ─────────────────────────────────────────────

  describe('searchMessages', () => {
    it('finds messages containing the query (case-insensitive)', async () => {
      const conv = await store.createConversation('Test Chat');
      const t = Date.now();
      await store.addMessage(conv.id, { role: 'user', text: 'Hello world', timestamp: t });
      await store.addMessage(conv.id, { role: 'assistant', text: 'Hi there', timestamp: t + 100 });
      await store.addMessage(conv.id, { role: 'user', text: 'HELLO again', timestamp: t + 200 });

      const results = await store.searchMessages('hello');
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.text.toLowerCase().includes('hello'))).toBe(true);
    });

    it('returns empty array for empty query', async () => {
      const conv = await store.createConversation('Test');
      await store.addMessage(conv.id, { role: 'user', text: 'Hello', timestamp: Date.now() });

      expect(await store.searchMessages('')).toEqual([]);
      expect(await store.searchMessages('   ')).toEqual([]);
    });

    it('respects limit parameter', async () => {
      const conv = await store.createConversation('Test');
      const t = Date.now();
      for (let i = 0; i < 5; i++) {
        await store.addMessage(conv.id, { role: 'user', text: `Match item ${i}`, timestamp: t + i });
      }

      const results = await store.searchMessages('Match', 3);
      expect(results).toHaveLength(3);
    });

    it('snippet extraction includes context around match', async () => {
      const conv = await store.createConversation('Test');
      await store.addMessage(conv.id, {
        role: 'user',
        text: 'The quick brown fox jumps over the lazy dog',
        timestamp: Date.now(),
      });

      const results = await store.searchMessages('fox');
      expect(results).toHaveLength(1);
      expect(results[0].snippet.match).toBe('fox');
      expect(results[0].snippet.before).toContain('brown');
      expect(results[0].snippet.after).toContain('jumps');
    });

    it('includes conversation name in results', async () => {
      const conv = await store.createConversation('My Special Chat');
      await store.addMessage(conv.id, { role: 'user', text: 'findme', timestamp: Date.now() });

      const results = await store.searchMessages('findme');
      expect(results).toHaveLength(1);
      expect(results[0].conversationName).toBe('My Special Chat');
    });

    it('returns results sorted by timestamp descending', async () => {
      const conv = await store.createConversation('Test');
      const t = Date.now();
      await store.addMessage(conv.id, { role: 'user', text: 'apple first', timestamp: t });
      await store.addMessage(conv.id, { role: 'user', text: 'apple second', timestamp: t + 500 });
      await store.addMessage(conv.id, { role: 'user', text: 'apple third', timestamp: t + 1000 });

      const results = await store.searchMessages('apple');
      expect(results).toHaveLength(3);
      expect(results[0].text).toBe('apple third');
      expect(results[1].text).toBe('apple second');
      expect(results[2].text).toBe('apple first');
    });
  });
});

// ── Snippet extraction ───────────────────────────────────

describe('extractSnippet', () => {
  it('extracts snippet with context', () => {
    const result = extractSnippet('The quick brown fox jumps over', 'fox');
    expect(result.match).toBe('fox');
    expect(result.before).toContain('brown');
    expect(result.after).toContain('jumps');
  });

  it('adds ellipsis when match is in the middle of long text', () => {
    const text = 'A'.repeat(60) + 'TARGET' + 'B'.repeat(60);
    const result = extractSnippet(text, 'TARGET');
    expect(result.before.startsWith('...')).toBe(true);
    expect(result.after.endsWith('...')).toBe(true);
  });

  it('handles match at start of text (no leading ellipsis)', () => {
    const result = extractSnippet('Hello world and more text', 'Hello');
    expect(result.before).toBe('');
    expect(result.match).toBe('Hello');
    expect(result.after).toContain('world');
  });

  it('handles match at end of text (no trailing ellipsis)', () => {
    const result = extractSnippet('Some text ending with target', 'target');
    expect(result.match).toBe('target');
    expect(result.after).toBe('');
    expect(result.before).toContain('with');
  });

  it('returns empty snippet for no match', () => {
    const result = extractSnippet('Hello world', 'xyz');
    expect(result).toEqual({ before: '', match: '', after: '' });
  });

  it('preserves original casing of the match', () => {
    const result = extractSnippet('The QuIcK Fox', 'quick');
    expect(result.match).toBe('QuIcK');
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
