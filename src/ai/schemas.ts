import { z } from 'zod';

const count = z.number().int().safe().nullable();
const text = z.string().max(300).nullable();
export const summaryFields = ['name', 'kills', 'assists', 'damage', 'revives', 'survivalTime'] as const;
export const detailedFields = ['name', 'kills', 'deaths', 'assists', 'damage', 'actualDamage', 'knockdowns', 'healing', 'help', 'revives', 'headshotRate'] as const;
export const SummaryPlayerSchema = z.object({ name: text, kills: count, assists: count, damage: count, revives: count, survivalTime: text }).strict();
export const DetailedPlayerSchema = z.object({ name: text, kills: count, deaths: count, assists: count, damage: count, actualDamage: count, knockdowns: count, healing: count, help: count, revives: count, headshotRate: z.number().finite().nullable(), kdaRaw: text.optional() }).strict();
const shared = { mode: z.literal('BATTLE_ROYALE').nullable(), mapRaw: text, placement: count, totalTeams: count, placementRaw: text.optional() };
export const MatchSummarySchema = z.object({ screenType: z.literal('MATCH_SUMMARY'), ...shared, players: z.array(SummaryPlayerSchema).max(16) }).strict();
export const DetailedStatsSchema = z.object({ screenType: z.literal('DETAILED_STATS'), ...shared, players: z.array(DetailedPlayerSchema).max(16) }).strict();
export const UnknownScreenshotSchema = z.object({ screenType: z.literal('UNKNOWN'), reason: text }).strict();
export const ClassificationSchema = z.object({
  screenType: z.enum(['MATCH_SUMMARY', 'DETAILED_STATS', 'UNKNOWN']),
  mode: z.literal('BATTLE_ROYALE').nullable(),
  mapRaw: text,
  placement: count,
  totalTeams: count,
  placementRaw: text,
  reason: text
}).strict();
// The vision model extracts only raw map text. The app attaches a canonical map.
export const ExtractionSchema = z.discriminatedUnion('screenType', [MatchSummarySchema, DetailedStatsSchema, UnknownScreenshotSchema]);
export const AnalysisResultSchema = z.discriminatedUnion('screenType', [MatchSummarySchema.extend({ map: text }), DetailedStatsSchema.extend({ map: text }), UnknownScreenshotSchema]);
export type Extraction = z.infer<typeof ExtractionSchema>;
export type Classification = z.infer<typeof ClassificationSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type ScreenType = AnalysisResult['screenType'];
export type PlayerField = typeof detailedFields[number] | typeof summaryFields[number];
export function emptyResult(screenType: ScreenType): AnalysisResult {
  if (screenType === 'UNKNOWN') return { screenType, reason: null };
  const shared = { mode: null, mapRaw: null, map: null, placement: null, totalTeams: null, players: [] };
  return screenType === 'MATCH_SUMMARY' ? { ...shared, screenType } : { ...shared, screenType };
}
