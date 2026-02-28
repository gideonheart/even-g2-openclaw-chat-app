import { describe, it, expect } from 'vitest';
import { SESSIONS, findSession, isActiveSession } from '../sessions';

describe('sessions', () => {
  describe('SESSIONS', () => {
    it('has 3 demo sessions', () => {
      expect(SESSIONS).toHaveLength(3);
    });

    it('includes gideon, atlas, helper', () => {
      const ids = SESSIONS.map((s) => s.id);
      expect(ids).toContain('gideon');
      expect(ids).toContain('atlas');
      expect(ids).toContain('helper');
    });

    it('each session has id, name, and desc', () => {
      for (const s of SESSIONS) {
        expect(s.id).toBeTruthy();
        expect(s.name).toBeTruthy();
        expect(s.desc).toBeTruthy();
      }
    });
  });

  describe('findSession', () => {
    it('finds gideon by id', () => {
      const session = findSession('gideon');
      expect(session).toBeDefined();
      expect(session!.name).toBe('Gideon');
    });

    it('returns undefined for unknown id', () => {
      expect(findSession('nonexistent')).toBeUndefined();
    });
  });

  describe('isActiveSession', () => {
    it('returns true when ids match', () => {
      expect(isActiveSession('gideon', 'gideon')).toBe(true);
    });

    it('returns false when ids differ', () => {
      expect(isActiveSession('gideon', 'atlas')).toBe(false);
    });
  });
});
