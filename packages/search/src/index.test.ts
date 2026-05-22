import { describe, expect, it } from 'vitest';
import { escapeLikePattern } from './index.js';

describe('PGlite search LIKE escaping', () => {
  it('escapes SQL LIKE wildcards and the escape character itself', () => {
    expect(escapeLikePattern('100%_match\\path')).toBe('100\\%\\_match\\\\path');
  });

  it('leaves normal search text readable', () => {
    expect(escapeLikePattern('hello world')).toBe('hello world');
  });
});
