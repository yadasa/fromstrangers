// js/vibeSimilarity.js
/**
 * Given two "vibes" objects (with the same 25 question keys),
 * returns a percentage [0–100] of how similar they are.
 *
 * We assume each answer ranges from -5 to +5, so the max per-question
 * difference is 10. 25 questions → maxTotalDiff = 250.
 */
export function computeVibeSimilarity(vibesA, vibesB) {
  const keys = Object.keys(vibesA);
  const maxDiffPerQuestion = 10;
  const maxTotalDiff = keys.length * maxDiffPerQuestion;

  // sum absolute diffs
  const totalDiff = keys.reduce((sum, key) => {
    const a = parseFloat(vibesA[key]) || 0;
    const b = parseFloat(vibesB[key]) || 0;
    return sum + Math.abs(a - b);
  }, 0);

  // similarity = 1 − (diff / maxDiff)
  const similarityFrac = 1 - totalDiff / maxTotalDiff;
  return Math.max(0, Math.min(1, similarityFrac)) * 100;
}
