import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
const exec = promisify(execFile);
const terminal = createInterface({ input: process.stdin, output: process.stdout });
try {
  const config = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const model = process.env.AI_MODEL ?? /"AI_MODEL"\s*:\s*"([^"]+)"/.exec(config)?.[1];
  if (!model) throw new Error('AI_MODEL is missing from wrangler.jsonc.');
  console.log(`Configured model: ${model}`);
  console.log('Read the Meta license and acceptable use policy before accepting:');
  console.log('https://github.com/meta-llama/llama-models/blob/main/models/llama3_2/LICENSE');
  console.log('https://github.com/meta-llama/llama-models/blob/main/models/llama3_2/USE_POLICY.md');
  if ((await terminal.question('Type agree to send the one-time license acceptance request: ')).trim() !== 'agree') throw new Error('No acceptance request sent.');
  // Capture credentials in memory. Never log the token or persist it in the app.
  let token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    try {
      const { stdout } = await exec(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'auth', 'token', '--json']);
      const credentials = JSON.parse(stdout);
      token = credentials.token;
    } catch { throw new Error('Wrangler credentials are unavailable. Run npx wrangler login, then rerun npm run cf:license.'); }
  }
  if (!token) throw new Error('Use Wrangler login or CLOUDFLARE_API_TOKEN; global API keys are not supported by this helper.');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) {
    const response = await fetch('https://api.cloudflare.com/client/v4/accounts', { headers });
    const data = await response.json();
    if (!response.ok || !data.success || !data.result?.length) throw new Error('Cannot list accounts. Set CLOUDFLARE_ACCOUNT_ID to your account ID and retry.');
    if (data.result.length === 1) accountId = data.result[0].id;
    else {
      data.result.forEach((account, i) => console.log(`${i + 1}. ${account.name} (${account.id})`));
      const index = Number(await terminal.question('Account number: ')) - 1;
      accountId = data.result[index]?.id;
    }
  }
  if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('Invalid Cloudflare account ID.');
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, { method: 'POST', headers, body: JSON.stringify({ prompt: 'agree' }), signal: AbortSignal.timeout(90_000) });
  const data = await response.json();
  if (!response.ok || data.success === false) throw new Error(`Cloudflare rejected the request (${response.status}). ${JSON.stringify(data.errors ?? [])}`);
  console.log('License request succeeded. Start live extraction with npm run dev.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { terminal.close(); }
