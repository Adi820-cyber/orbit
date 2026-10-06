import { describe, expect, it } from 'vitest';
import type { KnowledgeChunk } from '../ports.ts';
import { focus } from './focus.ts';
import { attributeCitations, normaliseCitations } from './responder.ts';

const chunk = (title: string, similarity: number, matchedBy: KnowledgeChunk['matchedBy'] = 'hybrid'): KnowledgeChunk => ({
  id: title, title, content: 'x', source: 's', domain: 'd', similarity, matchedBy, updatedAt: '2026-10-05T00:00:00.000Z',
});

describe('focus', () => {
  it('drops results far below the best one (live case: billing extras at 0.29-0.38 under a 0.64 answer)', () => {
    const kept = focus([chunk('Billing', 0.644), chunk('Unbilled revenue', 0.381, 'vector'), chunk('Leakage', 0.324, 'vector')], 'How much is unpaid?');
    expect(kept.map((c) => c.title)).toEqual(['Billing']);
  });

  it('needs a meaning-only match to reach the floor, so an unrelated question finds nothing', () => {
    expect(focus([chunk('About', 0.264, 'vector'), chunk('Limitation', 0.256, 'vector')], 'How many staff are late?')).toEqual([]);
    expect(focus([chunk('Contract turnaround time', 0.31, 'vector')], 'How quickly do we close agreements?')).toHaveLength(1);
  });

  it('lets the group summary stand for its per-hospital copies, unless a hospital is named', () => {
    const results = [
      chunk('Diagnoses on admission across Kestrion Health Group', 0.9),
      chunk('Diagnoses on admission at Kestrion Avenhurst Hospital', 0.93),
      chunk('Diagnoses on admission at Kestrion Brackmoor Hospital', 0.93),
    ];
    expect(focus(results, 'Why are patients admitted?').map((c) => c.title)).toEqual(['Diagnoses on admission across Kestrion Health Group']);
    expect(focus(results, 'Why are patients admitted at Avenhurst?').map((c) => c.title)).toEqual([
      'Diagnoses on admission across Kestrion Health Group',
      'Diagnoses on admission at Kestrion Avenhurst Hospital',
    ]);
  });

  it('keeps per-hospital results when there is no group summary of that topic', () => {
    expect(focus([chunk('Billing and collections at Kestrion Avenhurst Hospital', 0.6)], 'unpaid?')).toHaveLength(1);
  });
});

describe('normaliseCitations', () => {
  it('turns [1, 2], [1,2] and full-width brackets into [1][2]', () => {
    expect(normaliseCitations('A [1, 2]. B [3,4]. C 【5】.')).toBe('A [1][2]. B [3][4]. C [5].');
  });
  it('leaves ordinary bracketed text alone', () => {
    expect(normaliseCitations('Figures [illustrative] and [1].')).toBe('Figures [illustrative] and [1].');
  });
});

describe('attributeCitations', () => {
  const source = (title: string, content: string): KnowledgeChunk => ({ ...chunk(title, 0.8), content });
  const insurance = source('Insurance cover', '21617 policies; average coverage 70.1 percent.');
  const billing = source('Billing', 'Insurance covered 945762937 (58.0 percent) of 1631617426 billed.');

  it('reads "58.0" as a figure, not a sentence end, and cites the source holding it', () => {
    expect(attributeCitations('Insurance covered 945762937, 58.0 percent of bills. There are 21617 policies.', [insurance, billing]))
      .toBe('Insurance covered 945762937, 58.0 percent of bills [2]. There are 21617 policies [1].');
  });
  it('cites every source that holds a figure when no one source holds them all', () => {
    expect(attributeCitations('Of 21617 policies, 58.0 percent of value was covered.', [insurance, billing]))
      .toBe('Of 21617 policies, 58.0 percent of value was covered [1][2].');
  });
  it('leaves cited sentences, sentences without figures, and untraceable figures alone', () => {
    expect(attributeCitations('Covered 945762937 [2]. Coverage is broad. About 12 insurers.', [insurance, billing]))
      .toBe('Covered 945762937 [2]. Coverage is broad. About 12 insurers.');
  });
});
