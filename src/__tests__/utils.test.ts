import { describe, it, expect } from 'vitest';
import { escHtml, truncate } from '../utils';

describe('utils', () => {
  describe('escHtml', () => {
    it('escapes ampersand', () => {
      expect(escHtml('a&b')).toBe('a&amp;b');
    });

    it('escapes angle brackets', () => {
      expect(escHtml('<div>')).toBe('&lt;div&gt;');
    });

    it('escapes double quotes', () => {
      expect(escHtml('a"b')).toBe('a&quot;b');
    });

    it('handles empty string', () => {
      expect(escHtml('')).toBe('');
    });

    it('handles string with no special chars', () => {
      expect(escHtml('hello world')).toBe('hello world');
    });

    it('escapes multiple special chars in one string', () => {
      expect(escHtml('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
    });
  });

  describe('truncate', () => {
    it('returns short string unchanged', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });

    it('truncates long string with ellipsis', () => {
      expect(truncate('https://very-long-gateway-url.example.com/api/v1', 20)).toBe(
        'https://very-long-ga\u2026',
      );
    });

    it('returns string of exact max length unchanged', () => {
      expect(truncate('12345', 5)).toBe('12345');
    });

    it('truncates string one char over max', () => {
      expect(truncate('123456', 5)).toBe('12345\u2026');
    });
  });
});
