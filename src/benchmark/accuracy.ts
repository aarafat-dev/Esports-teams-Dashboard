import { detailedFields, summaryFields, type AnalysisResult } from '../ai/schemas';
import type { Screenshot } from '../shared/types';
export interface FieldMetric { correct: number; total: number; excludedNull: number; accuracy: number | null }
export function exactNameMatch(predicted: string | null | undefined, truth: string | null) { return predicted === truth; }
export function compareResults(prediction: AnalysisResult | null, truth: AnalysisResult) {
  const fields: Record<string, FieldMetric> = {};
  let perfect = true;
  const compare = (key: string, predicted: unknown, actual: unknown, missingRow = false) => {
    const metric = fields[key] ??= { correct: 0, total: 0, excludedNull: 0, accuracy: null };
    if (predicted !== actual || missingRow) perfect = false;
    if (actual === null && !missingRow) { metric.excludedNull++; return; }
    metric.total++;
    if (!missingRow && predicted === actual) metric.correct++;
  };
  compare('screenType', prediction?.screenType, truth.screenType);
  if (truth.screenType !== 'UNKNOWN') {
    const matched = prediction?.screenType === truth.screenType ? prediction : null;
    for (const key of ['mode', 'map', 'mapRaw', 'placement', 'totalTeams'] as const) compare(key, matched?.[key], truth[key]);
    const keys = truth.screenType === 'MATCH_SUMMARY' ? summaryFields : detailedFields;
    // Match by visual row position, never by a fuzzy nickname. Missing/extra rows
    // penalize every field rather than disappearing from the denominator.
    const count = Math.max(truth.players.length, matched?.players.length ?? 0);
    for (let i = 0; i < count; i++) {
      const actual = truth.players[i] as Record<string, unknown> | undefined;
      const predicted = matched?.players[i] as Record<string, unknown> | undefined;
      for (const key of keys) compare(key, predicted?.[key], actual?.[key], !actual || !predicted);
    }
  }
  for (const field of Object.values(fields)) field.accuracy = field.total ? field.correct / field.total : null;
  return { fields, perfect };
}
export function benchmark(screenshots: Screenshot[], policy: 'first' | 'latest' = 'first') {
  const groups: Record<string, Record<string, FieldMetric>> = {};
  let tested = 0, verified = 0, evaluated = 0, failed = 0, perfect = 0, durationSum = 0, durationCount = 0;
  const models = new Set<string>();
  for (const shot of screenshots) {
    const attempts = shot.attempts.filter(a => a.status !== 'PROCESSING');
    const attempt = policy === 'first' ? attempts[0] : attempts.at(-1);
    if (attempt) { tested++; models.add(attempt.model); if (attempt.status === 'FAILED') failed++; if (attempt.durationMs !== null) { durationSum += attempt.durationMs; durationCount++; } }
    if (!shot.correctedResult) continue;
    verified++;
    if (!attempt) continue;
    evaluated++;
    const comparison = compareResults(attempt.aiResult, shot.correctedResult);
    if (comparison.perfect) perfect++;
    const group = groups[shot.correctedResult.screenType] ??= {};
    for (const [key, value] of Object.entries(comparison.fields)) {
      const metric = group[key] ??= { correct: 0, total: 0, excludedNull: 0, accuracy: null };
      metric.correct += value.correct; metric.total += value.total; metric.excludedNull += value.excludedNull;
      metric.accuracy = metric.total ? metric.correct / metric.total : null;
    }
  }
  return { tested, verified, evaluated, failed, perfect, requiringCorrections: evaluated - perfect, perfectRate: evaluated ? perfect / evaluated : null, averageDurationMs: durationCount ? durationSum / durationCount : null, groups, models: [...models] };
}
