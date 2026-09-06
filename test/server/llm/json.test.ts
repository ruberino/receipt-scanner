import { describe, expect, it } from 'vitest';
import { ExtractionError } from '../../../src/server/lib/errors.ts';
import { parseJsonObject } from '../../../src/server/llm/json.ts';

describe('parseJsonObject', () => {
  it('parses a plain JSON object', () => {
    expect(parseJsonObject('{"a": 1}', 'extraction')).toEqual({ a: 1 });
  });

  it('strips a leading and trailing markdown code fence', () => {
    expect(parseJsonObject('```json\n{"a": 1}\n```', 'extraction')).toEqual({ a: 1 });
    expect(parseJsonObject('```\n{"a": 1}\n```', 'extraction')).toEqual({ a: 1 });
  });

  it('rejects a JSON array', () => {
    expect(() => parseJsonObject('[1, 2, 3]', 'extraction')).toThrow(ExtractionError);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseJsonObject('{not json', 'matching')).toThrow(ExtractionError);
  });

  it('rejects null', () => {
    expect(() => parseJsonObject('null', 'extraction')).toThrow(ExtractionError);
  });

  it('throws the documented Norwegian message and stage', () => {
    try {
      parseJsonObject('nope', 'matching');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ExtractionError);
      expect((error as ExtractionError).userMessage).toBe('Kunne ikke tolke svaret fra lesingen');
      expect((error as ExtractionError).stage).toBe('matching');
    }
  });
});
