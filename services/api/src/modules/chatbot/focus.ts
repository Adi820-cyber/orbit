import type { KnowledgeChunk } from '../ports.ts';

/*
 * Keeps what answers the question and drops the rest (ADR 0019), tuned on live
 * scores from the dev project's knowledge base:
 *
 * - Results far below the best one are noise. Real answers scored 0.64 to 0.93
 *   while loosely related extras scored 0.29 to 0.38, so anything under 75% of
 *   the best score goes.
 * - A match on meaning alone, sharing no word with the question, also needs a
 *   score of at least 0.30. Unrelated meaning-only matches scored 0.26; a
 *   genuine one ("close agreements" finding contract turnaround) scored 0.31.
 * - The group summary of a topic stands for its per-hospital copies, unless the
 *   question names a hospital: a chairman asking about the group should not get
 *   the same figure six more times.
 */

export const RELATIVE_FLOOR = 0.75;
export const MEANING_ONLY_FLOOR = 0.3;

const GROUP = / across Kestrion Health Group$/;
const HOSPITAL = / at (Kestrion (\w+) Hospital)$/;

function topicOf(title: string): string {
  return title.replace(GROUP, '').replace(HOSPITAL, '');
}

export function focus(chunks: readonly KnowledgeChunk[], question: string): KnowledgeChunk[] {
  const top = chunks.reduce((max, c) => Math.max(max, c.similarity), 0);
  const kept = chunks.filter(
    (c) => c.similarity >= top * RELATIVE_FLOOR && (c.matchedBy !== 'vector' || c.similarity >= MEANING_ONLY_FLOOR),
  );
  const asked = question.toLowerCase();
  const groupTopics = new Set(kept.filter((c) => GROUP.test(c.title)).map((c) => topicOf(c.title)));
  return kept.filter((c) => {
    const hospital = HOSPITAL.exec(c.title);
    if (!hospital || !groupTopics.has(topicOf(c.title))) return true;
    return asked.includes(hospital[2]!.toLowerCase());
  });
}
