import { z } from 'zod';
import { CloudflareVisionProvider } from '../ai/cloudflare';
import { AnalysisResultSchema } from '../ai/schemas';
import { validateAnalysis } from '../ai/validation';
import { PROMPT_VERSION } from '../ai/prompts';
import { D1BenchmarkStore, R2ImageStore } from '../storage/cloudflare';
import type { Attempt } from '../shared/types';
import { MAX_IMAGE_BYTES, readLimited, validateImage } from './upload';

interface Env { AI?: Ai; AI_MODEL: string; AI_INPUT_FORMAT: string; AI_TIMEOUT_MS: string; DB: D1Database; IMAGES: R2Bucket; ASSETS: Fetcher; BENCHMARK_PASSWORD?: string }
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const json = (body: unknown, status = 200) => Response.json(body, { status });
const jsonBody = async (request: Request) => JSON.parse(new TextDecoder().decode(await readLimited(request, 128 * 1024))) as unknown;
async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url), path = url.pathname;
  // Single shared password is optional locally, mandatory on a public hostname.
  // Browser-native Basic auth keeps this prototype private without an auth stack.
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local && !env.BENCHMARK_PASSWORD) return new Response('Set the BENCHMARK_PASSWORD Worker secret before using a public deployment.', { status: 503 });
  if (env.BENCHMARK_PASSWORD) {
    const expected = `Basic ${btoa(`benchmark:${env.BENCHMARK_PASSWORD}`)}`;
    if (request.headers.get('Authorization') !== expected) return new Response('Sign in with username benchmark and your benchmark password.', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Free Fire Benchmark", charset="UTF-8"' } });
  }
  if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
  if (!['GET', 'HEAD'].includes(request.method)) {
    const origin = request.headers.get('origin');
    if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'Cross-origin writes are not allowed.');
  }
  const store = new D1BenchmarkStore(env.DB), images = new R2ImageStore(env.IMAGES);
  if (path === '/api/config' && request.method === 'GET') return json({ model: env.AI_MODEL, aiAvailable: Boolean(env.AI), maxImageBytes: MAX_IMAGE_BYTES, confidence: { map: 'UNAVAILABLE', placement: 'UNAVAILABLE', playerNames: 'UNAVAILABLE', kills: 'UNAVAILABLE', assists: 'UNAVAILABLE', damage: 'UNAVAILABLE' } });
  if (path === '/api/tournaments') {
    if (request.method === 'GET') return json(await store.listTournaments());
    if (request.method === 'POST') {
      const data = z.object({ name: z.string().trim().min(1).max(120), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s, 'Invalid calendar date').nullable().optional() }).strict().parse(await jsonBody(request));
      return json(await store.createTournament(data.name, data.date ?? null), 201);
    }
  }
  const workspace = /^\/api\/tournaments\/([\w-]+)$/.exec(path);
  if (workspace && request.method === 'GET') {
    const tournament = await store.getTournament(workspace[1]);
    if (!tournament) throw new HttpError(404, 'Workspace not found.');
    await store.expireAttempts();
    return json({ tournament, screenshots: await store.listScreenshots(tournament.id) });
  }
  const upload = /^\/api\/tournaments\/([\w-]+)\/screenshots$/.exec(path);
  if (upload && request.method === 'POST') {
    if (!await store.getTournament(upload[1])) throw new HttpError(404, 'Workspace not found.');
    // One file per bounded request; the browser schedules the batch.
    const body = await readLimited(request, MAX_IMAGE_BYTES + 64 * 1024);
    const form = await new Response(body, { headers: { 'content-type': request.headers.get('content-type') ?? '' } }).formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'Choose an image to upload.');
    const bytes = await file.arrayBuffer();
    const mime = validateImage(new Uint8Array(bytes), file.type, file.name);
    const id = crypto.randomUUID();
    await images.put(id, bytes, mime);
    try { await store.createScreenshot(upload[1], file.name.slice(0, 255), mime, id); }
    catch (error) { await images.delete(id); throw error; }
    return json(await store.getScreenshot(id), 201);
  }
  const shotRoute = /^\/api\/screenshots\/([\w-]+)(?:\/(image|analyze|diagnostic|truth))?$/.exec(path);
  if (shotRoute) {
    await store.expireAttempts();
    const shot = await store.getScreenshot(shotRoute[1]);
    if (!shot) throw new HttpError(404, 'Screenshot not found.');
    const action = shotRoute[2];
    if (!action && request.method === 'GET') return json(shot);
    if (action === 'image' && request.method === 'GET') {
      const image = await images.get(shot.id); if (!image) throw new HttpError(404, 'Stored image is missing.');
      return new Response(image.bytes, { headers: { 'content-type': image.mime, 'content-disposition': 'inline', 'cache-control': 'private, max-age=3600' } });
    }
    if (action === 'analyze' && request.method === 'POST') {
      if (shot.attempts.some(a => a.status === 'PROCESSING')) throw new HttpError(409, 'This screenshot is already processing.');
      const a: Attempt = { id: crypto.randomUUID(), screenshotId: shot.id, model: env.AI_MODEL, timestamp: new Date().toISOString(), status: 'PROCESSING', analysisState: null, durationMs: null, rawResponse: null, parsedResult: null, aiResult: null, warnings: [], parsingErrors: [], error: null, promptVersion: PROMPT_VERSION, inputFormat: env.AI_INPUT_FORMAT };
      try { await store.createAttempt(a); } catch { throw new HttpError(409, 'An analysis is already active. Refresh the screenshot.'); }
      const started = Date.now();
      try {
        const image = await images.get(shot.id); if (!image) { a.analysisState = 'IMAGE_INVALID'; throw new Error('Stored image is missing.'); }
        const provider = new CloudflareVisionProvider(env.AI, env.AI_MODEL, env.AI_INPUT_FORMAT, Math.min(180_000, Math.max(1000, Number(env.AI_TIMEOUT_MS) || 90_000)));
        Object.assign(a, await provider.analyzeFreeFireScreenshot(new Uint8Array(image.bytes), image.mime));
        a.status = a.parsingErrors.length || a.warnings.length || a.aiResult?.screenType === 'UNKNOWN' ? 'NEEDS_REVIEW' : 'COMPLETED';
      } catch (error) {
        a.status = 'FAILED'; a.error = error instanceof Error ? error.message : 'Cloudflare inference failed. Please retry.';
        if (!a.analysisState) a.analysisState = /invalid data for image|decoding image|image dimensions|unsupported image/i.test(a.error) ? 'IMAGE_INVALID' : /timed out/i.test(a.error) ? 'AI_TIMEOUT' : 'AI_REQUEST_FAILED';
      }
      a.durationMs = Date.now() - started;
      await store.finishAttempt(a);
      return json(await store.getScreenshot(shot.id));
    }
    if (action === 'diagnostic' && request.method === 'POST') {
      const image = await images.get(shot.id); if (!image) throw new HttpError(404, 'Stored image is missing.');
      const provider = new CloudflareVisionProvider(env.AI, env.AI_MODEL, env.AI_INPUT_FORMAT, Math.min(180_000, Math.max(1000, Number(env.AI_TIMEOUT_MS) || 90_000)));
      try {
        const diagnostic = await provider.diagnoseFreeFireScreenshot(new Uint8Array(image.bytes), image.mime);
        console.info('[workers-ai] diagnostic result', diagnostic);
        return json(diagnostic);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Diagnostic inference failed.';
        console.error('[workers-ai] diagnostic error', { model: env.AI_MODEL, mime: image.mime, bytes: image.bytes.byteLength, message });
        throw new HttpError(502, message);
      }
    }
    if (action === 'truth' && request.method === 'PUT') {
      const body = z.object({ action: z.enum(['CONFIRMED', 'CORRECTED']), attemptId: z.string().nullable(), result: AnalysisResultSchema.optional() }).strict().parse(await jsonBody(request));
      const attempt = shot.attempts.find(a => a.id === body.attemptId);
      if (body.attemptId && !attempt) throw new HttpError(400, 'Analysis attempt does not belong to this screenshot.');
      const result = body.action === 'CONFIRMED' ? attempt?.aiResult : body.result;
      if (!result) throw new HttpError(400, 'No valid result is available to verify. Save manual corrections instead.');
      const errors = validateAnalysis(result).filter(i => i.severity === 'ERROR');
      if (errors.length) throw new HttpError(400, `Fix invalid ground truth: ${errors.map(i => `${i.path}: ${i.message}`).join('; ')}`);
      await store.saveTruth(shot.id, result, body.action, body.attemptId);
      return json(await store.getScreenshot(shot.id));
    }
  }
  throw new HttpError(404, 'API route not found.');
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response;
    try { response = await route(request, env); }
    catch (error) {
      if (error instanceof HttpError) response = json({ error: error.message }, error.status);
      else if (error instanceof z.ZodError) response = json({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
      else if (error instanceof SyntaxError) response = json({ error: 'Invalid JSON request.' }, 400);
      else {
        const message = error instanceof Error ? error.message : '';
        const known = /^(Image |Only PNG|Request |Choose an image)/.test(message);
        if (!known) console.error('Request failed', error);
        response = json({ error: known ? message : 'Server or storage operation failed. Check the Worker terminal and retry.' }, known ? 400 : 500);
      }
    }
    const secured = new Response(response.body, response);
    secured.headers.set('X-Content-Type-Options', 'nosniff');
    secured.headers.set('Referrer-Policy', 'same-origin');
    secured.headers.set('Content-Security-Policy', "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (new URL(request.url).pathname.startsWith('/api/')) secured.headers.set('Cache-Control', 'no-store');
    return secured;
  }
};
