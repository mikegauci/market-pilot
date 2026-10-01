/** Match Settings form: store decimal confidence (0.85) as whole percent (85). */
export function confidencePercentFromDecimal(confidence: number): number {
  return Math.round(confidence * 100);
}
