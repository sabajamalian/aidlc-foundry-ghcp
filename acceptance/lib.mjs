// Tiny dependency-free harness for executable acceptance checks.
// Each acceptance/proposal-<N>.mjs file calls check() once per acceptance criterion
// and then run(). Output is Markdown so the deploy workflow can post it as evidence.

const checks = [];

export const BASE_URL = (process.env.API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

export function check(name, fn) {
  checks.push({ name, fn });
}

export async function api(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, body: json, text };
}

export function expectEqual(actual, expected, label = 'value') {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export async function run() {
  const lines = [`Target: \`${BASE_URL}\``, '', '| Result | Criterion | Detail |', '|---|---|---|'];
  let failed = 0;
  for (const { name, fn } of checks) {
    const started = Date.now();
    try {
      const detail = (await fn()) ?? '';
      lines.push(`| PASS | ${name} | ${String(detail).replace(/\|/g, '\\|')} (${Date.now() - started} ms) |`);
    } catch (err) {
      failed += 1;
      lines.push(`| FAIL | ${name} | ${String(err?.message ?? err).replace(/\|/g, '\\|')} |`);
    }
  }
  lines.push('', `${checks.length - failed}/${checks.length} criteria passed.`);
  console.log(lines.join('\n'));
  process.exitCode = failed ? 1 : 0;
}
