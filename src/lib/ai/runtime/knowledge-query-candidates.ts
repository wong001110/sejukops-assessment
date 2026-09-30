/**
 * Literal keyword candidates only, not language tokenization or semantic retrieval.
 * Keep complete ASCII identifiers containing letters and digits, the whole question,
 * then whitespace/punctuation-delimited chunks. Every candidate is an original span.
 */
export function knowledgeQueryCandidates(rawQuestion: string): readonly string[] {
  const question = rawQuestion.trim();
  if (question.length < 2 || question.length > 120) return [];
  const identifiers = [...question.matchAll(/[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)*/g)]
    .map(([value]) => value)
    .filter((value) => /[A-Za-z]/.test(value) && /[0-9]/.test(value));
  const candidates: string[] = [];
  const add = (value: string) => {
    if (value.length >= 2 && value.length <= 120 && !candidates.includes(value) && candidates.length < 8) {
      candidates.push(value);
    }
  };
  // Reserve a slot for the whole question even when it contains many identifiers.
  for (const identifier of [...new Set(identifiers)].slice(0, 7)) add(identifier);
  add(question);
  for (const [chunk] of question.matchAll(/[^\s,，。.!！?？;；:：、/\\()（）\[\]{}"'“”‘’]+/gu)) add(chunk);
  return candidates;
}
