import { describe, expect, it } from 'vitest';
import { normalizeText } from '../../src/server/lib/normalize.ts';

describe('normalizeText', () => {
  it('matches the documented examples', () => {
    expect(normalizeText('Tine® Lettmelk 1L')).toBe('TINE LETTMELK 1L');
    expect(normalizeText('Grünerløkka')).toBe('GRÜNERLØKKA');
    expect(normalizeText('Kaffe, filtermalt (250g)')).toBe('KAFFE FILTERMALT 250G');
  });

  it('collapses whitespace and trims', () => {
    expect(normalizeText('  Lettmelk   1 l  ')).toBe('LETTMELK 1 L');
  });

  it('keeps digits and Norwegian letters', () => {
    expect(normalizeText('Grovbrød 750g')).toBe('GROVBRØD 750G');
  });

  it('treats punctuation-only differences as equal', () => {
    expect(normalizeText('TINE LETTMELK 1L')).toBe(normalizeText('Tine - Lettmelk, 1L!'));
  });
});
