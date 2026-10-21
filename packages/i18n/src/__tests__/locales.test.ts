import { describe, expect, it } from 'vitest';
import { LANGUAGES, resources } from '../index';

// { common: { retry: 'Retry' } }  ->  { 'common.retry': 'Retry' }
function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') {
    return { [prefix]: value };
  }
  const out: Record<string, string> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    Object.assign(out, flatten(child, prefix ? `${prefix}.${key}` : key));
  }
  return out;
}

// 'Guardian {{phone}}' -> ['phone']
const placeholders = (text: string) =>
  [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();
const english = flatten(resources.en.translation);

// English is the reference; every other language is checked against it.
describe.each(LANGUAGES.filter((l) => l !== 'en'))('%s translations', (language) => {
  const translated = flatten(resources[language].translation);

  it('has exactly the same keys as English', () => {
    expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort());
  });

  it('keeps every {{placeholder}} of the English text', () => {
    // A misspelt {{phon}} would show the raw text "{{phon}}" to the user.
    for (const [key, text] of Object.entries(english)) {
      expect(placeholders(translated[key] ?? ''), key).toEqual(placeholders(text));
    }
  });

  it('has no empty texts', () => {
    expect(Object.entries(translated).filter(([, text]) => text.trim() === '')).toEqual([]);
  });
});
