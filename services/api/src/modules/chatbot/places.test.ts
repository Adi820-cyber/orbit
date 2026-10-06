import { describe, expect, it } from 'vitest';
import { placesOutsideScope } from './places.ts';

const NORTH_COO = ['Kestrion Northern Region', 'Kestrion Avenhurst Hospital', 'Kestrion Brackmoor Hospital', 'Kestrion Calderwyn Hospital'];
const DHO = ['Kestrion Avenhurst Hospital'];
const CHAIRMAN = ['Kestrion Health Group', 'Kestrion Northern Region', 'Kestrion Southern Region', 'Kestrion Avenhurst Hospital', 'Kestrion Elverton Hospital'];

describe('placesOutsideScope', () => {
  it('flags a region outside the scope, however it is written (live case: North COO asking about the south)', () => {
    expect(placesOutsideScope('Show me the south region revenue', NORTH_COO)).toEqual(['south']);
    expect(placesOutsideScope('What is the revenue at Kestrion Southern Region', NORTH_COO)).toEqual(['southern']);
    expect(placesOutsideScope('how are things in the south?', NORTH_COO)).toEqual(['south']);
  });

  it('flags a hospital outside the scope', () => {
    expect(placesOutsideScope('How many beds at Elverton hospital?', NORTH_COO)).toEqual(['elverton']);
    expect(placesOutsideScope('Compare Avenhurst and Brackmoor hospitals', DHO)).toEqual(['brackmoor']);
  });

  it('lets places in scope through', () => {
    expect(placesOutsideScope('Show me the northern region revenue', NORTH_COO)).toEqual([]);
    expect(placesOutsideScope('How many staff are late at Avenhurst hospital?', DHO)).toEqual([]);
    expect(placesOutsideScope('Compare the north and south regions', CHAIRMAN)).toEqual([]);
  });

  it('ignores generic words and questions that name no place', () => {
    for (const question of [
      'Which hospital is worst on EBITDA?',
      'How is my region doing?',
      'Revenue for each hospital',
      'Beds and wards in the reference hospital',
      'How many patients were admitted as emergencies?',
      'how much insurance are claimed',
      'What needs my attention this month?',
    ]) {
      expect(placesOutsideScope(question, DHO), question).toEqual([]);
    }
  });

  it('does not read direction words inside other words', () => {
    expect(placesOutsideScope('What is the least profitable service?', NORTH_COO)).toEqual([]);
  });
});
