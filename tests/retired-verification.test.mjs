import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

for (const endpoint of ['start-vipps-verification', 'vipps-verification-callback']) {
  test(`${endpoint} rejects all requests without processing credentials or state`, async () => {
    let handler;
    runInNewContext(readFileSync(new URL(`../supabase/functions/${endpoint}/index.ts`, import.meta.url), 'utf8'), {
      Deno: { serve(callback) { handler = callback; } }, Response,
    });
    for (const method of ['GET', 'POST', 'OPTIONS']) {
      const response = await handler(new Request('https://example.test/?state=synthetic&code=synthetic', { method }));
      assert.equal(response.status, 410);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.json();
      assert.equal(body.error, 'VERIFICATION_RETIRED');
      assert.doesNotMatch(JSON.stringify(body), /synthetic/);
    }
  });
}
