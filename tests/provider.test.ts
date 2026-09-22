import { expect, it, vi } from 'vitest';
import { CloudflareVisionProvider } from '../src/ai/cloudflare';

const classifiedDetailed = JSON.stringify({ screenType: 'DETAILED_STATS', mode: 'BATTLE_ROYALE', mapRaw: 'BERMUDES', placement: 6, totalTeams: 12, placementRaw: '#6/12', reason: null });
const detailed = JSON.stringify({ screenType: 'DETAILED_STATS', mode: 'BATAILLE ROYALE', mapRaw: 'BERMUDES', placement: '6', totalTeams: '12', placementRaw: '#6/12', players: [{ name: '7C_TROJ4N!!', kills: '2', deaths: 2, assists: 1, damage: 1371, actualDamage: 1170, knockdowns: 4, healing: 983, help: 0, revives: 0, headshotRate: '100.00%', kdaRaw: '2/2/1' }] });

it('uses the current chat-completions image contract and two-stage extraction', async () => {
  const run = vi.fn().mockResolvedValueOnce({ choices: [{ message: { content: classifiedDetailed } }] }).mockResolvedValueOnce({ choices: [{ message: { content: detailed } }] });
  const provider = new CloudflareVisionProvider({ run } as unknown as Ai, 'configurable-model', 'chat-completions');
  const response = await provider.analyzeFreeFireScreenshot(new Uint8Array([1, 2, 3]), 'image/png');
  expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[0]).toEqual(['configurable-model', expect.objectContaining({ messages: expect.arrayContaining([expect.objectContaining({ content: expect.arrayContaining([expect.objectContaining({ type: 'image_url', image_url: { url: 'data:image/png;base64,AQID', detail: 'high' } })]) })]), response_format: { type: 'json_object' }, chat_template_kwargs: { enable_thinking: false } })]);
  expect(run.mock.calls[1][1]).toEqual(expect.objectContaining({ response_format: { type: 'json_object' } }));
  expect(response).toMatchObject({ analysisState: 'ANALYSIS_SUCCESS', aiResult: { screenType: 'DETAILED_STATS', mode: 'BATTLE_ROYALE', mapRaw: 'BERMUDES', map: 'BERMUDA', placement: 6, totalTeams: 12 } });
  expect(response.aiResult?.screenType === 'DETAILED_STATS' && response.aiResult.players[0].headshotRate).toBe(100);
});

it('keeps diagnostic vision output independent of extraction parsing', async () => {
  const run = vi.fn().mockResolvedValue({ choices: [{ message: { content: '', reasoning_content: 'I see BATAILLE ROYALE, BERMUDES, #6/12 and four rows.' } }] });
  const provider = new CloudflareVisionProvider({ run } as unknown as Ai, 'vision-model', 'chat-completions');
  const diagnostic = await provider.diagnoseFreeFireScreenshot(new Uint8Array([1, 2, 3]), 'image/jpeg');
  expect(run).toHaveBeenCalledWith('vision-model', expect.objectContaining({ messages: expect.arrayContaining([expect.objectContaining({ content: expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('Describe exactly what you see') }), expect.objectContaining({ image_url: { url: 'data:image/jpeg;base64,AQID', detail: 'high' } })]) })]) }));
  expect(diagnostic.responseText).toContain('BATAILLE ROYALE'); expect(diagnostic.rawResponse).toContain('BERMUDES'); expect(diagnostic.image.bytes).toBe(3); expect(diagnostic.model).toBe('vision-model');
});

it('uses UNKNOWN_SCREEN only after a successful model classification', async () => {
  const unknown = { screenType: 'UNKNOWN', mode: null, mapRaw: null, placement: null, totalTeams: null, placementRaw: null, reason: 'Lobby screen' };
  const run = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(unknown) } }] });
  const result = await new CloudflareVisionProvider({ run } as unknown as Ai, 'test', 'chat-completions').analyzeFreeFireScreenshot(new Uint8Array([1]), 'image/png');
  expect(run).toHaveBeenCalledTimes(1); expect(result.analysisState).toBe('UNKNOWN_SCREEN'); expect(result.aiResult).toEqual({ screenType: 'UNKNOWN', reason: 'Lobby screen' });
});

it('distinguishes malformed output from schema-invalid output', async () => {
  const malformed = await new CloudflareVisionProvider({ run: async () => ({ choices: [{ message: { content: '{"screenType":' } }] }) } as unknown as Ai, 'test', 'chat-completions').analyzeFreeFireScreenshot(new Uint8Array([1]), 'image/jpeg');
  expect(malformed.analysisState).toBe('AI_RESPONSE_PARSE_ERROR'); expect(malformed.rawResponse).toContain('screenType'); expect(malformed.aiResult).toBeNull();
  const run = vi.fn().mockResolvedValueOnce({ choices: [{ message: { content: classifiedDetailed } }] }).mockResolvedValueOnce({ choices: [{ message: { content: '{"screenType":"DETAILED_STATS"}' } }] });
  const invalid = await new CloudflareVisionProvider({ run } as unknown as Ai, 'test', 'chat-completions').analyzeFreeFireScreenshot(new Uint8Array([1]), 'image/jpeg');
  expect(invalid.analysisState).toBe('AI_SCHEMA_VALIDATION_ERROR'); expect(invalid.aiResult).toBeNull(); expect(invalid.parsingErrors.length).toBeGreaterThan(0);
});

it('surfaces empty, offline, inference, and timeout failures', async () => {
  const empty = await new CloudflareVisionProvider({ run: async () => ({ choices: [{ message: { content: '' } }] }) } as unknown as Ai, 'test', 'chat-completions').analyzeFreeFireScreenshot(new Uint8Array(), 'image/png');
  expect(empty.analysisState).toBe('AI_EMPTY_RESPONSE');
  await expect(new CloudflareVisionProvider(undefined, 'test', 'image').analyzeFreeFireScreenshot(new Uint8Array(), 'image/png')).rejects.toThrow('wrangler login');
  const provider = new CloudflareVisionProvider({ run: async () => { throw new Error('Quota exceeded'); } } as unknown as Ai, 'test', 'image');
  await expect(provider.analyzeFreeFireScreenshot(new Uint8Array(), 'image/png')).rejects.toThrow('Quota exceeded');
  const timed = new CloudflareVisionProvider({ run: () => new Promise(() => {}) } as unknown as Ai, 'test', 'image', 10);
  await expect(timed.analyzeFreeFireScreenshot(new Uint8Array(), 'image/png')).rejects.toThrow('timed out');
}, 2_000);
