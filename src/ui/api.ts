export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api${path}`, init); }
  catch { throw new Error('Network connection failed. Your saved records are retained; refresh to check the current status before retrying.'); }
  const data = await response.json().catch(() => ({ error: 'Server returned an unreadable response. Check the development terminal.' })) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status}).`);
  return data;
}
export const jsonRequest = (method: string, data: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
export const percent = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(1)}%`;
export const labels: Record<string, string> = { name: 'Player name', kills: 'Kills', deaths: 'Deaths', assists: 'Assists', damage: 'Damage', revives: 'Revives', survivalTime: 'Survival time', actualDamage: 'Actual damage', knockdowns: 'Knockdowns', healing: 'Healing', help: 'Help', headshotRate: 'Headshot %', map: 'Map (canonical)', mapRaw: 'Map (raw exact)', mode: 'Mode', placement: 'Placement', totalTeams: 'Total teams', screenType: 'Screen classification' };
