import { ClassificationSchema, ExtractionSchema } from './schemas';
import { normalizeExtraction, parseKda, parsePlacement } from './normalization';

function parseUniqueJson(raw: string): unknown {
  const value: unknown = JSON.parse(raw);
  // JSON.parse silently takes the last duplicate key. Reject that ambiguity.
  const stack: (Set<string> | null)[] = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '{') stack.push(new Set());
    else if (c === '[') stack.push(null);
    else if (c === '}' || c === ']') stack.pop();
    else if (c === '"') {
      const start = i; let escaped = false;
      while (++i < raw.length) {
        if (escaped) escaped = false;
        else if (raw[i] === '\\') escaped = true;
        else if (raw[i] === '"') break;
      }
      let next = i + 1; while (/\s/.test(raw[next] ?? '') && next < raw.length) next++;
      const keys = stack.at(-1);
      if (raw[next] === ':' && keys) {
        const key: string = JSON.parse(raw.slice(start, i + 1));
        if (keys.has(key)) throw new Error(`Duplicate JSON key: ${key}.`);
        keys.add(key);
      }
    }
  }
  return value;
}

// Accept one complete JSON object, including within prose/fences. Never repair
// truncated JSON, coerce numbers, choose between multiple objects, or fill keys.
export function extractJson(raw: string): unknown {
  if (raw.length > 200_000) throw new Error('AI response exceeds the 200 KB parsing limit.');
  try { return parseUniqueJson(raw); } catch (error) {
    if (error instanceof Error && error.message.startsWith('Duplicate JSON key:')) throw error;
    /* scan balanced objects */
  }
  const candidates: string[] = [];
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (start < 0) { if (c === '{') { start = i; depth = 1; } continue; }
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { candidates.push(raw.slice(start, i + 1)); start = -1; }
  }
  if (start >= 0) throw new Error('Incomplete JSON object; response may have been truncated.');
  if (candidates.length !== 1) throw new Error('Expected exactly one complete JSON object.');
  return parseUniqueJson(candidates[0]);
}

const numericFields = new Set(['placement', 'totalTeams', 'kills', 'deaths', 'assists', 'damage', 'actualDamage', 'knockdowns', 'healing', 'help', 'revives']);
function numberValue(value: unknown, percentage = false): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  const match = percentage ? /^(-?\d+(?:\.\d+)?)%$/.exec(text) : /^-?\d+$/.exec(text);
  if (!match) return value;
  const number = Number(percentage ? match[1] : text);
  return Number.isSafeInteger(number) || percentage && Number.isFinite(number) ? number : value;
}

// Normalize only deterministic representation differences. Raw parsed JSON is
// retained separately, names/maps are untouched, and ambiguous values survive
// to produce a schema error rather than being guessed.
export function normalizeModelOutput(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const output = structuredClone(value) as Record<string, unknown>;
  if (typeof output.screenType === 'string') {
    const type = output.screenType.trim().toUpperCase().replace(/[ -]+/g, '_');
    if (['MATCH_SUMMARY', 'DETAILED_STATS', 'UNKNOWN'].includes(type)) output.screenType = type;
  }
  if (typeof output.mode === 'string') {
    const mode = output.mode.trim().toUpperCase().replace(/[ -]+/g, '_');
    if (mode === 'BATTLE_ROYALE' || mode === 'BATAILLE_ROYALE') output.mode = 'BATTLE_ROYALE';
  }
  output.placement = numberValue(output.placement);
  output.totalTeams = numberValue(output.totalTeams);
  if ((output.placement === null || output.placement === undefined || output.totalTeams === null || output.totalTeams === undefined) && typeof output.placementRaw === 'string') {
    const placement = parsePlacement(output.placementRaw);
    if (placement) { output.placement ??= placement.placement; output.totalTeams ??= placement.totalTeams; }
  }
  if (Array.isArray(output.players)) output.players = output.players.map(player => {
    if (!player || typeof player !== 'object' || Array.isArray(player)) return player;
    const row = structuredClone(player) as Record<string, unknown>;
    for (const field of numericFields) if (field in row) row[field] = numberValue(row[field]);
    if ('headshotRate' in row) row.headshotRate = numberValue(row.headshotRate, true);
    if (typeof row.survivalTime === 'string') {
      const time = /^(\d{1,3})['’](\d{2})["”]?$/.exec(row.survivalTime.trim());
      if (time && Number(time[2]) < 60) row.survivalTime = `${time[1]}:${time[2]}`;
    }
    if (typeof row.kdaRaw === 'string') {
      const kda = parseKda(row.kdaRaw);
      if (kda) { row.kills ??= kda.kills; row.deaths ??= kda.deaths; row.assists ??= kda.assists; }
    }
    return row;
  });
  return output;
}

export function parseClassification(raw: string) {
  let parsedResult: unknown = null;
  try {
    parsedResult = extractJson(raw);
    const normalizedResult = normalizeModelOutput(parsedResult);
    const checked = ClassificationSchema.safeParse(normalizedResult);
    if (!checked.success) return { parsedResult, normalizedResult, classification: null, parsingErrors: checked.error.issues.map(i => `${i.path.join('.') || 'result'}: ${i.message}`), failureKind: 'SCHEMA' as const };
    return { parsedResult, normalizedResult, classification: checked.data, parsingErrors: [], failureKind: null };
  } catch (error) {
    return { parsedResult, normalizedResult: null, classification: null, parsingErrors: [error instanceof Error ? error.message : 'Invalid AI JSON.'], failureKind: 'PARSE' as const };
  }
}

export function parseAnalysis(raw: string) {
  let parsedResult: unknown = null;
  try {
    parsedResult = extractJson(raw);
    const normalizedResult = normalizeModelOutput(parsedResult);
    const checked = ExtractionSchema.safeParse(normalizedResult);
    if (!checked.success) return { parsedResult, normalizedResult, aiResult: null, parsingErrors: checked.error.issues.map(i => `${i.path.join('.') || 'result'}: ${i.message}`), failureKind: 'SCHEMA' as const };
    return { parsedResult, normalizedResult, aiResult: normalizeExtraction(checked.data), parsingErrors: [], failureKind: null };
  } catch (error) {
    return { parsedResult, normalizedResult: null, aiResult: null, parsingErrors: [error instanceof Error ? error.message : 'Invalid AI JSON.'], failureKind: 'PARSE' as const };
  }
}
