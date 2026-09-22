import type { VisionProvider, ProviderResult } from './provider';
import type { DiagnosticResult } from './provider';
import { CLASSIFICATION_JSON_SCHEMA, CLASSIFICATION_PROMPT, DETAILED_STATS_JSON_SCHEMA, DETAILED_STATS_PROMPT, DIAGNOSTIC_PROMPT, EXTRACTION_JSON_SCHEMA, EXTRACTION_PROMPT, MATCH_SUMMARY_JSON_SCHEMA, MATCH_SUMMARY_PROMPT } from './prompts';
import { parseAnalysis, parseClassification } from './parsing';
import { validateAnalysis } from './validation';
import { inspectImage } from './image-metadata';
export class CloudflareVisionProvider implements VisionProvider {
  constructor(private ai: Ai | undefined, private model: string, private format: string, private timeoutMs = 90_000) {}
  async analyzeFreeFireScreenshot(image: Uint8Array, mime: string): Promise<ProviderResult> {
    if (this.format === 'chat-completions') return this.analyzeTwoStage(image, mime);
    const response = await this.runVision(image, mime, EXTRACTION_PROMPT, EXTRACTION_JSON_SCHEMA, 'free_fire_analysis');
    const content = this.modelResponseText(response);
    const rawResponse = JSON.stringify(response) ?? 'null';
    console.info('[workers-ai] complete raw structured response', rawResponse);
    const parsed = typeof content === 'string' ? parseAnalysis(content) : parseAnalysis(JSON.stringify(content));
    this.logParseStages('extraction', content, parsed);
    const analysisState = parsed.aiResult ? parsed.aiResult.screenType === 'UNKNOWN' ? 'UNKNOWN_SCREEN' : 'ANALYSIS_SUCCESS' : parsed.failureKind === 'SCHEMA' ? 'AI_SCHEMA_VALIDATION_ERROR' : 'AI_RESPONSE_PARSE_ERROR';
    return { rawResponse, ...parsed, analysisState, warnings: parsed.aiResult ? validateAnalysis(parsed.aiResult) : [] };
  }

  private async analyzeTwoStage(image: Uint8Array, mime: string): Promise<ProviderResult> {
    const classificationResponse = await this.runVision(image, mime, CLASSIFICATION_PROMPT, CLASSIFICATION_JSON_SCHEMA, 'free_fire_classification', 'object');
    const classificationText = this.modelResponseText(classificationResponse);
    if (!classificationText) return { rawResponse: JSON.stringify({ classification: classificationResponse, extraction: null }), parsedResult: null, aiResult: null, analysisState: 'AI_EMPTY_RESPONSE', parsingErrors: ['AI_EMPTY_RESPONSE: classification response contained no text or structured object.'], warnings: [] };
    const classified = parseClassification(classificationText);
    this.logParseStages('classification', classificationText, classified);
    if (!classified.classification) return { rawResponse: JSON.stringify({ classification: classificationResponse, extraction: null }), parsedResult: classified.parsedResult, aiResult: null, analysisState: classified.failureKind === 'SCHEMA' ? 'AI_SCHEMA_VALIDATION_ERROR' : 'AI_RESPONSE_PARSE_ERROR', parsingErrors: classified.parsingErrors, warnings: [] };
    if (classified.classification.screenType === 'UNKNOWN') {
      const aiResult = { screenType: 'UNKNOWN' as const, reason: classified.classification.reason };
      return { rawResponse: JSON.stringify({ classification: classificationResponse, extraction: null }), parsedResult: classified.parsedResult, aiResult, analysisState: 'UNKNOWN_SCREEN', parsingErrors: [], warnings: validateAnalysis(aiResult) };
    }
    const detailed = classified.classification.screenType === 'DETAILED_STATS';
    // Gemma's strict JSON-schema decoder can enter a whitespace loop after an
    // array and exhaust the output limit. JSON object mode avoids that provider
    // bug; the result still goes through our exact Zod discriminated union.
    const extractionResponse = await this.runVision(image, mime, detailed ? DETAILED_STATS_PROMPT : MATCH_SUMMARY_PROMPT, detailed ? DETAILED_STATS_JSON_SCHEMA : MATCH_SUMMARY_JSON_SCHEMA, detailed ? 'free_fire_detailed_stats' : 'free_fire_match_summary', 'object');
    const extractionText = this.modelResponseText(extractionResponse);
    const rawResponse = JSON.stringify({ classification: classificationResponse, extraction: extractionResponse });
    if (!extractionText) return { rawResponse, parsedResult: null, aiResult: null, analysisState: 'AI_EMPTY_RESPONSE', parsingErrors: ['AI_EMPTY_RESPONSE: extraction response contained no text or structured object.'], warnings: [] };
    const parsed = parseAnalysis(extractionText);
    this.logParseStages('extraction', extractionText, parsed);
    return { rawResponse, ...parsed, analysisState: parsed.aiResult ? 'ANALYSIS_SUCCESS' : parsed.failureKind === 'SCHEMA' ? 'AI_SCHEMA_VALIDATION_ERROR' : 'AI_RESPONSE_PARSE_ERROR', warnings: parsed.aiResult ? validateAnalysis(parsed.aiResult) : [] };
  }

  async diagnoseFreeFireScreenshot(image: Uint8Array, mime: string): Promise<DiagnosticResult> {
    const metadata = await inspectImage(image, mime);
    const started = Date.now();
    const response = await this.runVision(image, mime, DIAGNOSTIC_PROMPT);
    const rawResponse = JSON.stringify(response) ?? 'null';
    const responseText = this.modelResponseText(response);
    return { rawResponse, responseText, prompt: DIAGNOSTIC_PROMPT, model: this.model, image: metadata, durationMs: Date.now() - started };
  }

  private async runVision(image: Uint8Array, mime: string, prompt: string, schema?: unknown, schemaName = 'free_fire_analysis', responseMode: 'schema' | 'object' = 'schema'): Promise<unknown> {
    if (!this.ai) throw new Error('Workers AI is unavailable in offline mode. Run npx wrangler login, then npm run dev.');
    let binary = '';
    for (let i = 0; i < image.length; i += 8192) binary += String.fromCharCode(...image.subarray(i, i + 8192));
    const dataUrl = `data:${mime};base64,${btoa(binary)}`;
    // Cloudflare currently exposes two distinct multimodal contracts. Llama
    // 3.2 Vision uses a top-level `image`; newer OpenAI-compatible models use
    // an `image_url` message part and a named response-format schema.
    const structured = schema !== undefined;
    const input = this.format === 'chat-completions'
      ? {
          messages: [
            { role: 'system', content: 'You are a precise visual extraction system. Follow the requested output format exactly.' },
            { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }] }
          ],
          max_completion_tokens: structured ? 2048 : 2048,
          temperature: 0,
          stream: false,
          chat_template_kwargs: { enable_thinking: false },
          ...(structured ? { response_format: responseMode === 'object' ? { type: 'json_object' } : { type: 'json_schema', json_schema: { name: schemaName, description: 'Free Fire screenshot classification and visible statistics', strict: true, schema } } } : {})
        }
      : this.format === 'messages'
        ? { messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }] }], max_tokens: structured ? 4096 : 2048, temperature: 0, stream: false }
        : { messages: [{ role: 'system', content: 'You are a precise visual analysis assistant.' }, { role: 'user', content: prompt }], image: dataUrl, max_tokens: structured ? 4096 : 2048, temperature: 0, stream: false };
    if (!['image', 'messages', 'chat-completions'].includes(this.format)) throw new Error('Unsupported AI_INPUT_FORMAT. Use image, messages, or chat-completions.');
    const metadata = await inspectImage(image, mime);
    console.info('[workers-ai] request image metadata', { ...metadata, model: this.model, format: this.format, structured });
    console.info('[workers-ai] exact prompt', prompt);
    console.info('[workers-ai] input contract', this.format === 'image' ? { messages: input.messages, image: { mime, included: true, dataUrlBytes: dataUrl.length }, response_format: (input as { response_format?: unknown }).response_format } : { messages: input.messages, response_format: (input as { response_format?: unknown }).response_format, thinking: (input as { chat_template_kwargs?: unknown }).chat_template_kwargs });
    console.info('[workers-ai] image payload', { dataUrlPrefix: dataUrl.slice(0, dataUrl.indexOf(',') + 1), base64Bytes: dataUrl.length - dataUrl.indexOf(',') - 1, included: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response: unknown = await Promise.race([
        this.ai.run(this.model as Parameters<Ai['run']>[0], input as unknown as Parameters<Ai['run']>[1]),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`AI inference timed out after ${this.timeoutMs / 1000}s. Retry creates a new attempt.`)), this.timeoutMs); })
      ]);
      console.info('[workers-ai] complete raw response before parsing', JSON.stringify(response) ?? 'null');
      return response;
    } finally { clearTimeout(timer); }
  }

  private modelResponseText(response: unknown): string | null {
    if (typeof response === 'string') return response;
    const envelope = response as { response?: unknown; answer?: unknown; description?: unknown; choices?: { text?: unknown; message?: { content?: unknown; reasoning_content?: unknown } }[] } | null;
    const message = envelope?.choices?.[0]?.message;
    const primary = envelope?.response ?? envelope?.answer ?? envelope?.description ?? message?.content;
    const content = primary === '' || primary === undefined || primary === null ? message?.reasoning_content ?? envelope?.choices?.[0]?.text : primary;
    return typeof content === 'string' ? content : content === undefined ? null : JSON.stringify(content);
  }

  private logParseStages(stage: string, modelText: string | null, parsed: { parsedResult: unknown; normalizedResult?: unknown; aiResult?: unknown; classification?: unknown; parsingErrors: string[]; failureKind?: unknown }) {
    console.info(`[workers-ai] ${stage} model response text`, modelText);
    console.info(`[workers-ai] ${stage} JSON extracted from response`, parsed.parsedResult);
    console.info(`[workers-ai] ${stage} parsed/normalized JSON`, parsed.normalizedResult);
    console.info(`[workers-ai] ${stage} schema validation result`, { success: !parsed.parsingErrors.length, failureKind: parsed.failureKind, errors: parsed.parsingErrors });
    console.info(`[workers-ai] ${stage} final normalized result`, parsed.aiResult ?? parsed.classification ?? null);
  }
}
