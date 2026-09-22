import type { AnalysisResult } from './schemas';
import { parseKda, parsePlacement } from './normalization';
export interface ValidationIssue { severity: 'WARNING' | 'ERROR'; path: string; message: string }
export function validateAnalysis(result: AnalysisResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string, severity: ValidationIssue['severity'] = 'WARNING') => issues.push({ path, message, severity });
  if (result.screenType === 'UNKNOWN') { add('screenType', 'Unrecognized screenshot. Human review required.'); return issues; }
  for (const field of ['mapRaw', 'map', 'placement', 'totalTeams', 'mode'] as const) if (result[field] === null || result[field] === '') add(field, 'Missing or unreadable value.');
  if (result.placement !== null && result.placement < 1) add('placement', 'Placement must be positive.', 'ERROR');
  if (result.totalTeams !== null && result.totalTeams < 1) add('totalTeams', 'Total teams must be positive.', 'ERROR');
  if (result.placement !== null && result.totalTeams !== null && result.placement > result.totalTeams) add('placement', 'Placement exceeds total teams.', 'ERROR');
  if (result.placementRaw) {
    const parsed = parsePlacement(result.placementRaw);
    if (!parsed || parsed.placement !== result.placement || parsed.totalTeams !== result.totalTeams) add('placementRaw', 'Raw placement does not agree with numeric fields.');
  }
  if (!result.players.length) add('players', 'No players detected on a recognized result screen.');
  const rows = new Set<string>();
  result.players.forEach((player, index) => {
    const path = `players.${index}`;
    if (!player.name?.trim()) add(`${path}.name`, 'Player name is missing or empty.');
    if (Object.values(player).every(v => v === null || v === '')) add(path, 'Empty player row.');
    const row = JSON.stringify(player);
    if (rows.has(row)) add(path, 'Duplicate identical player row.');
    rows.add(row);
    for (const [key, value] of Object.entries(player)) {
      if (value === null) add(`${path}.${key}`, 'Missing or unreadable value.');
      if (typeof value === 'number' && value < 0) add(`${path}.${key}`, 'Statistics cannot be negative.', 'ERROR');
    }
    if ('survivalTime' in player && player.survivalTime !== null && !/^\d{1,3}:[0-5]\d$/.test(player.survivalTime)) add(`${path}.survivalTime`, 'Expected minutes:seconds, for example 13:29.', 'ERROR');
    if ('headshotRate' in player && player.headshotRate !== null && player.headshotRate > 100) add(`${path}.headshotRate`, 'Headshot percentage exceeds 100.', 'ERROR');
    if ('kdaRaw' in player && player.kdaRaw) {
      const parsed = parseKda(player.kdaRaw);
      if (!parsed || parsed.kills !== player.kills || parsed.deaths !== player.deaths || parsed.assists !== player.assists) add(`${path}.kdaRaw`, 'Raw K/D/A does not agree with numeric fields.');
    }
  });
  return issues;
}
export function calculateTotals(result: AnalysisResult) {
  const players = result.screenType === 'UNKNOWN' ? [] : result.players;
  const sum = (field: 'kills' | 'assists' | 'damage') => players.length && players.every(p => p[field] !== null) ? players.reduce((n, p) => n + (p[field] ?? 0), 0) : null;
  return { teamKills: sum('kills'), teamAssists: sum('assists'), teamDamage: sum('damage') };
}
