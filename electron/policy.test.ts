import { describe, expect, it } from 'vitest';
import { isAllowedExternal, safeFileName, sanitizeFilters } from './policy';

describe('isAllowedExternal', () => {
  it.each([
    ['https://www.blender.org/download/lts/4-5/', true],
    ['https://download.blender.org/release/Blender4.5/', true],
    ['https://github.com/djkim9031-research/wedding-floor-planner', true],
    ['http://www.blender.org/', false],
    ['https://evil.example.com/', false],
    ['https://www.blender.org.evil.com/', false],
    ['https://user:pw@github.com/', false],
    ['file:///etc/passwd', false],
    ['javascript:alert(1)', false],
    ['app://planner/index.html', false],
    ['not a url', false],
  ])('%s → %s', (url, ok) => {
    expect(isAllowedExternal(url)).toBe(ok);
  });
  it('rejects non-strings', () => expect(isAllowedExternal(42)).toBe(false));
});

describe('sanitizeFilters', () => {
  it('keeps well-formed filters and strips dots', () => {
    expect(sanitizeFilters([{ name: 'Layout', extensions: ['.json'] }, { name: 'Images', extensions: ['png', 'jpg'] }])).toEqual([
      { name: 'Layout', extensions: ['json'] },
      { name: 'Images', extensions: ['png', 'jpg'] },
    ]);
  });
  it('drops junk', () => {
    expect(sanitizeFilters('json')).toEqual([]);
    expect(sanitizeFilters([null, { name: 1 }, { name: 'x', extensions: ['../x', 5] }])).toEqual([]);
  });
});

describe('safeFileName', () => {
  it.each([
    ['wedding-layout.json', 'wedding-layout.json'],
    ['../../etc/passwd', 'passwd'],
    ['a\\b\\c.json', 'c.json'],
    ['.hidden', 'hidden'],
    ['', 'untitled'],
    [undefined, 'untitled'],
    ['Photo 12:30.png', 'Photo 12-30.png'],
  ])('%j → %j', (inp, out) => {
    expect(safeFileName(inp)).toBe(out);
  });
});
