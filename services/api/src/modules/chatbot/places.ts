/*
 * Places a chatbot question names, checked against the caller's own scope.
 *
 * Search only returns what the caller may read, so a question about a place
 * outside their scope would otherwise be answered with whatever inside their
 * scope looks similar: the North COO asking about "the south region" got North
 * figures. That silently narrows the request, which Orbit never does
 * (out_of_scope is an explicit result). So a question that names a place is
 * answered only when every place it names is one the caller can see.
 *
 * The check compares the question with the names of the caller's own visible
 * entities only. It never looks at entities outside the scope, so the answer
 * cannot confirm whether some other hospital or region exists.
 */

/** Direction words, folded so "south", "southern" and "Southern Region" meet. */
const DIRECTIONS: Readonly<Record<string, string>> = {
  north: 'north', northern: 'north',
  south: 'south', southern: 'south',
  east: 'east', eastern: 'east',
  west: 'west', western: 'west',
  central: 'central',
};

/** Words before "hospital" or "region" that do not name a place. */
const GENERIC = new Set([
  'a', 'all', 'any', 'both', 'each', 'every', 'my', 'our', 'your', 'their', 'its', 'the', 'this', 'that', 'these', 'those',
  'which', 'what', 'one', 'per', 'same', 'other', 'another', 'whole', 'entire', 'single', 'specific', 'particular',
  'main', 'top', 'best', 'worst', 'largest', 'biggest', 'smallest', 'busiest', 'new', 'reference', 'private',
  'government', 'public', 'general', 'teaching', 'district', 'local', 'nearest', 'different', 'given', 'in', 'at',
  'for', 'by', 'of', 'across', 'from', 'to',
]);

const PLACE_NOUN = /\b([a-z][a-z'-]*)\s+(?:regions?|hospitals?|facilit(?:y|ies)|cent(?:re|er)s?|campus(?:es)?|clinics?)\b/g;

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z]+/g) ?? [];
}

const fold = (word: string) => DIRECTIONS[word] ?? word;

/**
 * The words in `question` that name a place none of `visibleLabels` matches,
 * in the order they first appear. Empty when the question names no place, or
 * only places in scope.
 */
export function placesOutsideScope(question: string, visibleLabels: readonly string[]): string[] {
  const visible = new Set(visibleLabels.flatMap((label) => words(label).map(fold)));
  const text = question.toLowerCase();
  const named: string[] = [];
  const add = (word: string) => {
    if (!GENERIC.has(word) && !named.includes(word)) named.push(word);
  };
  for (const match of text.matchAll(PLACE_NOUN)) add(match[1]!);
  for (const word of words(text)) if (word in DIRECTIONS) add(word);
  return named.filter((word) => !visible.has(fold(word)));
}
