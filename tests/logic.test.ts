import { describe, expect, it } from 'vitest';
import { AnalysisResultSchema, DetailedStatsSchema, ExtractionSchema, MatchSummarySchema } from '../src/ai/schemas';
import type { AnalysisResult } from '../src/ai/schemas';
import { normalizeExtraction, normalizeMap, parseKda, parsePlacement } from '../src/ai/normalization';
import { extractJson, normalizeModelOutput, parseAnalysis } from '../src/ai/parsing';
import { calculateTotals, validateAnalysis } from '../src/ai/validation';
import { benchmark, compareResults, exactNameMatch } from '../src/benchmark/accuracy';
import { validateImage, readLimited, MAX_IMAGE_BYTES } from '../src/server/upload';
import type { Attempt, Screenshot } from '../src/shared/types';

const summary = {
  screenType: 'MATCH_SUMMARY' as const, mode: 'BATTLE_ROYALE' as const, mapRaw: 'NEX TERRA', placement: 4, totalTeams: 12,
  players: [
    { name: '#R', kills: 7, assists: 4, damage: 3868, revives: 5, survivalTime: '13:29' },
    { name: '7C_TROJ4N!!', kills: 4, assists: 1, damage: 2529, revives: 0, survivalTime: '13:17' },
    { name: '#A', kills: 4, assists: 3, damage: 1492, revives: 1, survivalTime: '15:53' },
    { name: '#B', kills: 1, assists: 3, damage: 685, revives: 0, survivalTime: '13:17' }
  ]
};
const detailed = { screenType: 'DETAILED_STATS' as const, mode: 'BATTLE_ROYALE' as const, mapRaw: 'BERMUDES', placement: 6, totalTeams: 12, players: [{ name: '7C_TROJ4N!!', kills: 2, deaths: 2, assists: 1, damage: 1371, actualDamage: 1170, knockdowns: 4, healing: 983, help: 0, revives: 0, headshotRate: 0, kdaRaw: '2/2/1' }] };
const result = () => normalizeExtraction(structuredClone(summary));
describe('deterministic normalization', () => {
  it.each([['#4/12', 4], ['#11/12', 11], ['#6/12', 6]])('parses placement %s', (raw, placement) => expect(parsePlacement(raw)).toEqual({ placement, totalTeams: 12 }));
  it.each(['#13/12', '#0/12', '-1/12', '#4/12 extra', '4', '1/9007199254740992'])('rejects ambiguous placement %s', raw => expect(parsePlacement(raw)).toBeNull());
  it('splits K/D/A into integers', () => expect(parseKda('2/2/1')).toEqual({ kills: 2, deaths: 2, assists: 1 }));
  it.each(['2/1', '2/2/1oops', '2/-2/1', '2/2/1.5'])('rejects bad K/D/A %s', raw => expect(parseKda(raw)).toBeNull());
  it.each([['BERMUDES', 'BERMUDA'], ['BERMUDA', 'BERMUDA'], ['KALAHARI', 'KALAHARI'], ['NEXTERRA', 'NEX TERRA'], [' nex   terra ', 'NEX TERRA'], [null, null], ['New Map', 'New Map']])('normalizes map %s', (raw, expected) => expect(normalizeMap(raw)).toBe(expected));
  it('preserves raw maps and names byte-for-byte', () => { const raw = structuredClone(summary); raw.mapRaw = '  BERMUDES '; raw.players[0].name = '★ALL★STARS★\u00a0#_!!'; const output = normalizeExtraction(raw); expect(output).toMatchObject({ mapRaw: raw.mapRaw, map: 'BERMUDA', players: raw.players }); });
  it('normalizes only unambiguous model representations before validation', () => expect(normalizeModelOutput({ screenType: 'detailed stats', mode: 'BATAILLE ROYALE', placement: '6', totalTeams: '12', mapRaw: 'BERMUDES', players: [{ name: '#R', kills: '2', headshotRate: '100.00%' }] })).toMatchObject({ screenType: 'DETAILED_STATS', mode: 'BATTLE_ROYALE', placement: 6, totalTeams: 12, mapRaw: 'BERMUDES', players: [{ name: '#R', kills: 2, headshotRate: 100 }] }));
});
describe('schemas and safe parsing', () => {
  it('accepts both distinct screen schemas', () => { expect(MatchSummarySchema.safeParse(summary).success).toBe(true); expect(DetailedStatsSchema.safeParse(detailed).success).toBe(true); expect(AnalysisResultSchema.safeParse(result()).success).toBe(true); });
  it('does not coerce numeric strings', () => expect(ExtractionSchema.safeParse({ ...summary, placement: '4' }).success).toBe(false));
  it('requires explicit nullable fields', () => expect(ExtractionSchema.safeParse({ ...summary, totalTeams: undefined }).success).toBe(false));
  it('does not allow fabricated stats for UNKNOWN', () => expect(ExtractionSchema.safeParse({ screenType: 'UNKNOWN', reason: 'Lobby', players: [] }).success).toBe(false));
  it('rejects unknown keys and mixed screen columns', () => expect(ExtractionSchema.safeParse({ ...summary, players: [{ ...summary.players[0], deaths: 1 }] }).success).toBe(false));
  it('accepts plain JSON, fences and surrounding prose', () => { for (const text of [JSON.stringify(summary), `\`\`\`json\n${JSON.stringify(summary)}\n\`\`\``, `Here is the result:\n${JSON.stringify(summary)}\nDone.`]) expect(parseAnalysis(text).aiResult).toEqual(result()); });
  it('handles braces and escapes inside names without changing them', () => { const raw = { ...summary, players: [{ ...summary.players[0], name: 'x{\\"}★' }] }; expect(extractJson(`Result: ${JSON.stringify(raw)}`)).toEqual(raw); });
  it.each(['{"screenType":', '{} {}', 'No JSON', '{"x":1,}', '{"x":1} trailing {'])('rejects malformed or ambiguous JSON %s', text => expect(parseAnalysis(text).parsingErrors.length).toBeGreaterThan(0));
  it('retains parsed partial data but never treats it as validated', () => { const parsed = parseAnalysis('{"screenType":"MATCH_SUMMARY","placement":4}'); expect(parsed.parsedResult).toMatchObject({ placement: 4 }); expect(parsed.aiResult).toBeNull(); });
  it('rejects arrays instead of extracting nested objects', () => expect(parseAnalysis(`[${JSON.stringify(summary)}]`).aiResult).toBeNull());
  it('rejects duplicate keys instead of choosing a conflicting statistic', () => {
    expect(() => extractJson('{"kills":1,"kills":9}')).toThrow('Duplicate JSON key');
    expect(() => extractJson('Result: {"players":[{"name":"A","name":"B"}]}')).toThrow('Duplicate JSON key');
    expect(extractJson('{"players":[{"name":"A"},{"name":"B"}]}')).toEqual({ players: [{ name: 'A' }, { name: 'B' }] });
  });
});
describe('non-mutating validation and totals', () => {
  it('calculates team kills, assists and damage', () => expect(calculateTotals(result())).toEqual({ teamKills: 16, teamAssists: 11, teamDamage: 8574 }));
  it('never represents an incomplete sum as a complete total', () => { const value = result(); if (value.screenType === 'UNKNOWN') return; value.players[0].damage = null; expect(calculateTotals(value).teamDamage).toBeNull(); expect(calculateTotals(value).teamKills).toBe(16); });
  it('does not invent zero totals for zero rows', () => expect(calculateTotals({ screenType: 'UNKNOWN', reason: null }).teamKills).toBeNull());
  it('flags negative statistics, bad placement, duplicate rows, and leaves data intact', () => {
    const value = result(); if (value.screenType !== 'MATCH_SUMMARY') return; value.placement = 13; value.players[0].kills = -1; value.players.push(structuredClone(value.players[0]));
    const before = structuredClone(value), warnings = validateAnalysis(value);
    expect(warnings.some(w => w.path === 'placement' && w.severity === 'ERROR')).toBe(true); expect(warnings.some(w => w.message.includes('negative'))).toBe(true); expect(warnings.some(w => w.message.includes('Duplicate'))).toBe(true); expect(value).toEqual(before);
  });
  it('flags missing players and names', () => { const value = result(); if (value.screenType === 'UNKNOWN') return; value.players[0].name = null; expect(validateAnalysis(value).some(w => w.path === 'players.0.name')).toBe(true); value.players = []; expect(validateAnalysis(value).some(w => w.path === 'players')).toBe(true); });
  it('checks survival time and headshot bounds', () => { expect(validateAnalysis(normalizeExtraction({ ...summary, players: [{ ...summary.players[0], survivalTime: '13:99' }] })).some(i => i.severity === 'ERROR')).toBe(true); expect(validateAnalysis(normalizeExtraction({ ...detailed, players: [{ ...detailed.players[0], headshotRate: 101 }] })).some(i => i.severity === 'ERROR')).toBe(true); });
  it('checks raw placement and KDA against extracted numbers', () => { expect(validateAnalysis(normalizeExtraction({ ...detailed, placementRaw: '#4/12', players: [{ ...detailed.players[0], kills: 9 }] })).map(i => i.path)).toEqual(['placementRaw', 'players.0.kdaRaw']); });
});
describe('objective accuracy', () => {
  it.each([['7C_TROJ4N!', '7C_TROJ4N!!'], ['#R', 'R'], ['★ALL★STARS★', 'ALLSTARS'], ['#A ', '#A'], ['É', 'E\u0301']])('uses strict nickname equality for %s', (a, b) => expect(exactNameMatch(a, b)).toBe(false));
  it('counts a fully correct screenshot as perfect', () => expect(compareResults(result(), result()).perfect).toBe(true));
  it('fails a one-character nickname error', () => { const prediction = result(); if (prediction.screenType === 'UNKNOWN') return; prediction.players[1].name = '7C_TROJ4N!'; const score = compareResults(prediction, result()); expect(score.perfect).toBe(false); expect(score.fields.name).toMatchObject({ correct: 3, total: 4, accuracy: .75 }); });
  it('penalizes missing and extra player rows', () => {
    const missing = result(); if (missing.screenType === 'UNKNOWN') return; missing.players.pop(); expect(compareResults(missing, result()).fields.kills).toMatchObject({ correct: 3, total: 4 });
    const extra = result(); if (extra.screenType !== 'MATCH_SUMMARY') return; extra.players.push(structuredClone(extra.players[0])); expect(compareResults(extra, result()).fields.kills).toMatchObject({ correct: 4, total: 5 });
  });
  it('does not align by fuzzy name or drop failed analyses', () => { const reordered = result(); if (reordered.screenType === 'UNKNOWN') return; reordered.players.reverse(); expect(compareResults(reordered, result()).fields.name.correct).toBe(0); expect(compareResults(null, result()).fields.kills).toMatchObject({ correct: 0, total: 4 }); });
  it('scores wrong screen type as failure on all visible fields', () => expect(compareResults({ screenType: 'UNKNOWN', reason: 'uncertain' }, result()).fields.damage).toMatchObject({ correct: 0, total: 4 }));
  it('excludes null human fields from field metrics but catches hallucinations for perfect score', () => { const truth = result(); if (truth.screenType === 'UNKNOWN') return; truth.players[0].damage = null; const comparison = compareResults(result(), truth); expect(comparison.fields.damage).toMatchObject({ correct: 3, total: 3, excludedNull: 1 }); expect(comparison.perfect).toBe(false); });
  it('scores all detailed stats independently', () => { const truth = normalizeExtraction(detailed), predicted = structuredClone(truth); if (predicted.screenType !== 'DETAILED_STATS') return; predicted.players[0].actualDamage = 1171; const score = compareResults(predicted, truth); expect(score.fields.actualDamage.accuracy).toBe(0); expect(score.fields.damage.accuracy).toBe(1); expect(score.fields.deaths.accuracy).toBe(1); });
  it('does not evaluate unverified screenshots, and keeps first attempts as default', () => {
    const attempt = (id: string, aiResult: AnalysisResult | null): Attempt => ({ id, screenshotId: 's', model: 'model-a', timestamp: id, status: aiResult ? 'COMPLETED' : 'FAILED', analysisState: aiResult ? 'ANALYSIS_SUCCESS' : 'AI_REQUEST_FAILED', durationMs: 100, rawResponse: null, parsedResult: null, aiResult, warnings: [], parsingErrors: [], error: null, promptVersion: 'v1', inputFormat: 'image' });
    const shot: Screenshot = { id: 's', tournamentId: 't', filename: 's.png', mime: 'image/png', uploadedAt: '', correctedResult: null, verifiedAt: null, verificationKind: null, verifiedAttemptId: null, attempts: [attempt('1', null), attempt('2', result())], status: 'COMPLETED' };
    expect(benchmark([shot])).toMatchObject({ tested: 1, evaluated: 0, perfectRate: null }); shot.correctedResult = result();
    expect(benchmark([shot])).toMatchObject({ perfect: 0, failed: 1, requiringCorrections: 1 }); expect(benchmark([shot], 'latest')).toMatchObject({ perfect: 1, perfectRate: 1, failed: 0 });
  });
});
describe('upload boundaries', () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  it('checks content signature, MIME and extension', () => { expect(validateImage(png, 'image/png', 'screen.png')).toBe('image/png'); expect(() => validateImage(png, 'image/jpeg', 'screen.jpg')).toThrow(); expect(() => validateImage(png, 'image/png', 'screen.svg')).toThrow(); expect(() => validateImage(new TextEncoder().encode('<script>'), 'image/png', 'fake.png')).toThrow(); });
  it('rejects empty and oversized uploads', () => { expect(() => validateImage(new Uint8Array(), 'image/png', 'empty.png')).toThrow(); expect(() => validateImage(new Uint8Array(MAX_IMAGE_BYTES + 1), 'image/png', 'big.png')).toThrow(); });
  it('bounds streaming requests even without a content-length header', async () => { const request = new Request('http://localhost', { method: 'POST', body: '12345' }); await expect(readLimited(request, 4)).rejects.toThrow('too large'); });
});
