import type { AnalysisResult, Extraction } from './schemas';
export const MAP_ALIASES: Record<string, string> = { BERMUDES: 'BERMUDA', BERMUDA: 'BERMUDA', KALAHARI: 'KALAHARI', 'NEX TERRA': 'NEX TERRA', NEXTERRA: 'NEX TERRA', PURGATORY: 'PURGATORY', PURGATOIRE: 'PURGATORY', ALPINE: 'ALPINE' };
export function normalizeMap(raw: string | null): string | null {
  if (raw === null || raw.trim() === '') return null;
  return MAP_ALIASES[raw.trim().toUpperCase().replace(/\s+/g, ' ')] ?? raw;
}
export function normalizeExtraction(value: Extraction): AnalysisResult {
  return value.screenType === 'UNKNOWN' ? value : { ...value, map: normalizeMap(value.mapRaw) };
}
export function parsePlacement(raw: string): { placement: number; totalTeams: number } | null {
  const match = /^#?(\d+)\s*\/\s*(\d+)$/.exec(raw.trim());
  if (!match) return null;
  const placement = Number(match[1]), totalTeams = Number(match[2]);
  return Number.isSafeInteger(placement) && Number.isSafeInteger(totalTeams) && placement > 0 && totalTeams >= placement ? { placement, totalTeams } : null;
}
export function parseKda(raw: string): { kills: number; deaths: number; assists: number } | null {
  const match = /^(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)$/.exec(raw.trim());
  if (!match) return null;
  const values = match.slice(1).map(Number);
  return values.every(Number.isSafeInteger) ? { kills: values[0], deaths: values[1], assists: values[2] } : null;
}
