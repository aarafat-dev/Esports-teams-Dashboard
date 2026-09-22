import { expect, it } from 'vitest';
import worker from '../src/server';
const env = { ASSETS: { fetch: async () => new Response('app') } } as unknown as Parameters<typeof worker.fetch>[1];
it('refuses public deployment without the benchmark password', async () => {
  const response = await worker.fetch(new Request('https://benchmark.example/'), env);
  expect(response.status).toBe(503);
});
it('protects assets and APIs with the same password', async () => {
  const secured = { ...env, BENCHMARK_PASSWORD: 'test-secret' };
  expect((await worker.fetch(new Request('https://benchmark.example/api/config'), secured)).status).toBe(401);
  const response = await worker.fetch(new Request('https://benchmark.example/', { headers: { Authorization: `Basic ${btoa('benchmark:test-secret')}` } }), secured);
  expect(response.status).toBe(200); expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
});
it('rejects cross-origin writes before accessing storage', async () => {
  const response = await worker.fetch(new Request('http://localhost/api/tournaments', { method: 'POST', headers: { Origin: 'https://elsewhere.example' }, body: '{}' }), env);
  expect(response.status).toBe(403);
});
