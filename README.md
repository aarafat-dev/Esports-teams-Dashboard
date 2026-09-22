# Free Fire Analytics — AI Screenshot Extraction Test

A focused vision extraction benchmark for real Garena Free Fire Battle Royale screenshots. A test tournament is a private workspace for matches played elsewhere. This application does not organize tournaments or implement SaaS billing, registration, teams, brackets, or matchmaking.

Create a workspace, upload screenshots, run Cloudflare Workers AI, inspect the original beside editable statistics, save human ground truth, and measure exact extraction accuracy. No traditional OCR engine is installed or used.

## Quick start (Linux)

Use Node.js 22.12+ or Node.js 24 LTS and npm. From this repository:

```bash
npm install
npx wrangler login
npm run cf:license
npm run dev
```

Open **http://127.0.0.1:8787**. `npm run dev` builds the frontend, applies local D1 migrations, and starts the Worker with remote Workers AI inference. You do **not** need to provision remote D1 or R2 resources for local use. The database ID in the checked-in configuration is a local placeholder.

`wrangler login` opens Cloudflare authentication in your browser. The license helper asks you to read and accept Meta's license and acceptable use policy, then sends the documented `{ "prompt": "agree" }` request. It obtains the Wrangler OAuth token privately in a subprocess; credentials are never printed, saved in application data, or sent to the frontend. If several accounts are available, choose the correct account. Alternatively supply `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in your terminal environment. Keep credentials out of source control.

The unauthenticated local mode runs without any Cloudflare login:

```bash
npm run dev:offline
```

Upload, review, ground truth, and results work in offline mode. Inference produces a clearly labeled failed attempt explaining how to enable Workers AI. **There are no fake predictions or demo accuracy numbers.** Wrangler warns that the offline environment omits the AI binding; this omission is intentional. Both modes use the same local storage.

For frontend hot reload, leave either Worker command running and use a second terminal:

```bash
npm run dev:ui
```

Open Vite's displayed URL (normally http://127.0.0.1:5173). Its `/api` proxy connects to the Worker on port 8787. Without Vite, rerun `npm run build` after frontend changes; Wrangler reloads Worker source edits itself.

## Cloudflare AI model and current documentation

Documentation and catalog checked on **2026-09-12**:

- [Llama 3.2 11B Vision Instruct model](https://developers.cloudflare.com/workers-ai/models/llama-3.2-11b-vision-instruct/): the requested `@cf/meta/llama-3.2-11b-vision-instruct` is still listed as a supported vision model. Its documented image input accepts an image alongside the prompt and returns generated text in `response`.
- [Official Llama vision tutorial](https://developers.cloudflare.com/workers-ai/guides/tutorials/llama-vision-tutorial/): demonstrates base64 image data and the AI binding.
- [Model catalog](https://developers.cloudflare.com/workers-ai/models/): newer vision candidates exist, including Moondream 3.1 and other multimodal models. Catalog descriptions do not establish superior accuracy on dense Free Fire tables or decorative nicknames. The requested, inexpensive Llama model is the initial baseline; switching based on measured accuracy is the purpose of this prototype.
- [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/): Llama is eligible for the shared allocation of 10,000 neurons/day. Free usage is finite and inference during local development uses the account allocation. A batch of 100 images is not guaranteed to fit into one day's allowance.
- [Workers AI bindings](https://developers.cloudflare.com/workers-ai/configuration/bindings/) and [local development](https://developers.cloudflare.com/workers/local-development/): `ai.binding = "AI"`, `remote = true`. Workers AI inference is remote even when the Worker and storage run locally.
- [Static asset routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/): the Worker serves the React build and API from the same origin.

The server calls `env.AI.run` inside `CloudflareVisionProvider`. The request includes the actual image as a base64 data URL, the versioned extraction prompt, `temperature: 0`, `stream: false`, and an output allowance of 4096 tokens. Classification precedes extraction within one inference request to limit cost and latency. Temperature zero does not guarantee identical results across retries.

### Vision pipeline diagnostics

For a stored screenshot, the temporary endpoint `POST /api/screenshots/:id/diagnostic` sends the same bytes and model to Workers AI with a plain-language vision prompt. It returns the model name, MIME type, byte count, parsed image dimensions, SHA-256, duration, complete raw response envelope, and response text. The Worker logs the exact prompt, non-secret input contract, data-URL prefix/base64 length, and raw response before any parser runs. Use it with the local Worker, for example:

```bash
curl -X POST http://127.0.0.1:8787/api/screenshots/SCREENSHOT_ID/diagnostic
```

The Llama Vision model is confirmed to see these screenshots, but its live vision responses currently ignore the requested `response_format` and often return explanatory prose (sometimes with malformed JSON embedded in it). The strict parser therefore preserves the raw response and records `NEEDS_REVIEW` with a parsing error; it never turns that failure into fabricated statistics.

Cloudflare does not provide calibrated confidence for individual extracted fields in this contract. Map, placement, names, kills, assists, and damage confidence are explicitly **UNAVAILABLE**. These are not model confidence percentages.

## First screenshot

1. Click **Create Test Tournament**, enter a name such as `MENA Scrim Test`, optionally select a date, then create the workspace.
2. Click **Upload Screenshots** or drag files into the drop zone. Select PNG/JPG/JPEG files, up to 8 MB each, with up to 100 files per batch. Inspect the previews before analyzing.
3. Click **Analyze N Screenshots**. Files are uploaded and analyzed independently, one at a time. Progress and each result remain visible. A failure does not stop later images. Keep the tab open until the batch finishes.
4. Click a screenshot to review it. Zoom and scroll the original, or open the full-size image in a new tab.
5. Inspect all fields, including raw map text, exact nickname punctuation, and row order. **Confirm As Correct** copies the selected prediction; **Save Corrections** saves the editable human result. **Save & next** speeds up larger review sessions.
6. Open **Test Results** to inspect field accuracy, perfect screenshots, failures, and mean processing time. Export benchmark JSON to retain all attempts and ground truth for further analysis.

Expected extraction:

| Screen | Fields |
| --- | --- |
| Both recognized screens | mode, mapRaw, normalized map, placement, totalTeams, ordered player rows |
| MATCH_SUMMARY | exact name, kills, assists, damage, revives, survivalTime |
| DETAILED_STATS | exact name, kills, deaths, assists, damage, actualDamage, knockdowns, healing, help, revives, headshotRate |
| UNKNOWN | screenType and reason only; no invented statistics |

Raw placement and K/D/A strings can also be preserved as audit fields. Numeric placement/totalTeams and split kills/deaths/assists are required independently. Headshot rate uses percentage units, 0–100. All unreadable values must be null. Clearing an editor input stores null. Team kills, assists, and damage are computed in code; a total is unavailable if any contributing value is missing.

## Architecture

```text
React + Vite browser UI
  → same-origin Worker API
      → VisionProvider → CloudflareVisionProvider → env.AI.run
      → safe JSON parsing → Zod schema → deterministic normalization/validation
      → BenchmarkStore → local D1 (SQLite via Wrangler)
      → ImageStore → local R2 emulator
```

- `src/ai/provider.ts`: provider interface for future Ollama/Qwen or hosted implementations.
- `src/ai/cloudflare.ts`: the only inference integration; model-specific input handling stays here.
- `src/ai/prompts.ts`: full extraction prompt and prompt version.
- `src/ai/schemas.ts`: distinct strict screenshot/player schemas. New types can extend the discriminated union and review renderer.
- `src/ai/parsing.ts`: parses a single complete object, including Markdown fences or surrounding explanatory text. Ambiguous objects, incomplete JSON, missing keys, type errors, and extra keys are not silently repaired.
- `src/ai/normalization.ts`: growable map aliases and strict placement/KDA helpers. Only map normalization changes extracted data, producing a separate canonical field. Raw parsed output remains preserved. Nicknames are never normalized.
- `src/ai/validation.ts`: reports issues without changing predictions. Flags negative values, invalid placement/time/percentages, missing fields/players, duplicates, and disagreement with raw audit strings.
- `src/benchmark/accuracy.ts`: exact comparisons and aggregation shared by the UI and tests.
- `src/storage/`: database and image abstractions; no public image bucket or CDN.
- `src/server/`: bounded uploads, API, analysis lifecycle, corrections, and access controls.

## Storage, ground truth, and retries

Wrangler persists the database and original image objects under `.wrangler/state/`. Restarting the server retains them. Keep this directory to retain the experiment; do not commit it. Export JSON includes metadata, all raw/parsed responses, validated predictions, timing, errors, and ground truth, but not image bytes. Back up `.wrangler/state/` while the server is stopped to preserve the originals too.

Tables:

- `tournaments`: name, optional date, creation timestamp.
- `screenshots`: UUID, workspace ID, display filename, media type, upload timestamp, shared corrected result, verification timestamp/kind, and source attempt ID.
- `attempts`: immutable completed predictions, model identifier, prompt version, input format, timestamp, status, duration, raw response envelope, parsed JSON, validated AI result, validation issues, parsing errors, inference errors.

Saving human ground truth never updates the original prediction. The latest saved human result is shared across attempts for that screenshot. Editing ground truth again replaces that human version; historical human revision tracking is not included. Retrying creates a new model-specific attempt and retains earlier attempts and saved ground truth. The review screen can load any attempt into the editor. Selecting an attempt alone changes the debug view; use **Load selected prediction** to replace editor contents.

Statuses are `UPLOADED`, `PROCESSING`, `COMPLETED`, `NEEDS_REVIEW`, `FAILED`, and screenshot-level `VERIFIED`. Unknown screenshots, invalid or partial model JSON, and validation warnings become `NEEDS_REVIEW`. Inference/network/model timeout failures become `FAILED`. A verified screenshot retains `VERIFIED` after a retry, while its attempt history separately retains failed or successful runs. The workspace failed counter checks the latest attempt, even when the image has ground truth.

One in-progress attempt is allowed per screenshot through a database constraint. Abandoned processing attempts expire after five minutes on the next API read and remain recorded as failures. Inference has a configurable 90-second application timeout. The underlying binding call may continue remotely after this timer; a late response is not saved over a finished attempt. Browser batch scheduling is intentionally simple and can later become background jobs.

## Accuracy methodology

Only screenshots with **both human ground truth and a finished analysis attempt** contribute to accuracy. Uploaded/processing images are not accuracy samples. Failed analyses count as mismatches against verified visible fields; they are not silently excluded.

The default policy uses the **first finished attempt** for each screenshot, including failures, so retrying until the model succeeds cannot improve the baseline. A selector also shows the latest finished attempt. All attempts stay in exports, with their model and prompt version. A warning appears if the selection mixes models. This is preparation for model comparisons, not a full multi-model dashboard.

- Field accuracy = exact matches / evaluated field instances, grouped by human-confirmed screen type.
- Player names use strict string equality. No trimming, Unicode normalization, case folding, or fuzzy matching. `7C_TROJ4N!` and `7C_TROJ4N!!` are different.
- Players are aligned by visible top-to-bottom row position. Add missing players, then use the row up/down buttons to put them in their visual positions. Extra/missing rows penalize every player field. Row reordering is an extraction error.
- Null human fields are excluded from that field's denominator and reported separately. Predicted null against visible ground truth is an error. Null cannot mean an assumed zero.
- Perfect screenshot rate = screenshots whose **every required field** exactly matches / evaluated verified screenshots. This includes classification, mode, raw/canonical map, placement, team count, every applicable player field, and row count. A non-null prediction against null truth prevents perfection, even though that null truth field is excluded from field accuracy.
- Optional raw placement/KDA strings and free-text UNKNOWN reasons are audit fields, not scored extraction values. UNKNOWN vs UNKNOWN matches classification only.
- No-correction counts are computed from selected predictions versus saved truth, rather than trusting which save button was clicked.
- Mean duration includes all selected finished attempts, including failed ones. Per-attempt duration is available in debug information and export.

## Change the model

Edit the root `vars` in `wrangler.jsonc` and restart the Worker:

```json
{
  "AI_MODEL": "@cf/meta/llama-3.2-11b-vision-instruct",
  "AI_INPUT_FORMAT": "image",
  "AI_TIMEOUT_MS": "90000"
}
```

The model ID is never hardcoded into inference code. `image` uses the documented prompt + image data URL contract. `messages` offers an explicit multimodal messages + image_url adapter for models supporting that format. A different model's request/response contract must be verified against its current documentation; merely changing the ID does not guarantee compatibility. Add other input/output adapters within the provider. The offline environment has its own non-inherited vars, so update those too if comparing offline fixtures/configuration. Every attempt records the actual configured model.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Unit tests cover placement/KDA parsing, map normalization, exact nickname preservation, both schemas, malformed/partial/ambiguous AI JSON, non-mutating validation, totals, null handling, failed analyses, missing/extra rows, accuracy, uploads, and transport/timeout contracts. Transport stubs do not simulate or claim to evaluate model intelligence.

Playwright uses the real local Worker, D1, and image storage in offline mode. It verifies batch continuation after inference failures, correction persistence, retry history, benchmark results/export, invalid uploads, and mobile layout. It creates clearly named E2E workspaces in the local database. Stop a live-inference dev server before running this suite; its fixtures assume offline mode.

## Optional deployment

Deployment is not required for the experiment. To deploy, provision remote resources:

```bash
npx wrangler d1 create free-fire-benchmark
npx wrangler r2 bucket create free-fire-benchmark-images
```

Replace the root `d1_databases[0].database_id` placeholder in `wrangler.jsonc` with the real ID returned by the create command. The R2 bucket name already matches. Then:

```bash
npx wrangler d1 migrations apply DB --remote
npx wrangler secret put BENCHMARK_PASSWORD
npm run deploy
```

Use Basic-auth username `benchmark` and the password you set (ASCII recommended). Public deployments refuse to serve the application without that secret. This is a single-user/shared-password prototype, not account management. Original screenshots and debug results remain behind the same access check. Do not enable public R2 access. Remote resources may require account setup; local emulation needs none. No production deployment has been performed by this implementation.

## Security and limits

Image requests are bounded even without Content-Length; file extension, MIME type, and PNG/JPEG signatures are checked. Objects use generated UUID keys, never user filenames. Display filenames are untrusted text and React escapes them. Raw debug output is displayed as text. Same-origin write checks, no-store API responses, nosniff, and a content security policy are configured. The app does not execute uploaded files. File signature checks are not a full image decoder; corrupt files with valid signatures may still fail inference.

## Known limitations

- **Actual extraction accuracy has not been established.** No real Free Fire screenshots or authenticated Workers AI account were supplied during development. Run your own 20–100 image dataset to answer the research question.
- Dense small text, decorative nicknames, overlapping badges, blur, and model-side image resizing can cause errors. The app sends originals without downscaling; there is no crop/tiling strategy yet.
- Image classification and extraction use one model request. Prompt adherence and valid JSON are not guaranteed; failures are retained for inspection.
- The batch runs while the browser remains open. It resumes saved uploaded images manually; it is not a durable background queue. Refreshing mid-batch discards only unuploaded previews and can interrupt requests.
- Workspace API responses currently include all attempt history. This is reasonable for the initial 20–100 screenshot experiment; pagination would be appropriate for much larger datasets.
- The model, application, and Cloudflare have finite output/usage limits. Long outputs may be truncated and marked for review. Free-tier quotas can interrupt a large batch.
- Human verification quality determines benchmark validity. A hurried confirmation can make incorrect data appear accurate. Review every visible field and maintain visual row order.
- Retry history and latest shared ground truth are persisted, but ground-truth revision history and dedicated model-comparison UI are deferred.
- R2 is only a tiny private blob adapter backed by local disk in development. No CDN, image transformation pipeline, paid services, or production-scale queues are required.
