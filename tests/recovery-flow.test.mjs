import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const reset = readFileSync(new URL('../reset-password.js', import.meta.url), 'utf8');
const callback = readFileSync(new URL('../auth-callback.js', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../auth.js', import.meta.url), 'utf8');
const config = readFileSync(new URL('../supabase-config.js', import.meta.url), 'utf8');

assert.match(reset, /query\.get\('code'\)[\s\S]+exchangeCodeForSession/);
assert.match(reset, /query\.get\('token_hash'\)[\s\S]+type: 'recovery'/);
assert.match(reset, /fragment\.get\('access_token'\)[\s\S]+fragment\.get\('refresh_token'\)/);
assert.doesNotMatch(reset, /else\s*\{\s*result = await supabase\.auth\.getSession\(\)/);
assert.match(reset, /else\s*\{[\s\S]{0,600}clearSensitiveUrl\(\);[\s\S]{0,80}showInvalid\(\);[\s\S]{0,40}return;/);
assert.match(reset, /password\.length < 6/);
assert.match(reset, /password !== passwordConfirm/);
assert.match(reset, /await supabase\.auth\.signOut\(\)/);

assert.doesNotMatch(callback, /else\s*\{\s*result = await supabase\.auth\.getSession\(\)/);
assert.match(callback, /else\s*\{[\s\S]{0,180}clearSensitiveUrl\(\);[\s\S]{0,80}showError\(\);[\s\S]{0,40}return;/);
assert.match(auth, /resetPasswordForEmail\(email, \{ redirectTo \}\)/);
assert.match(config, /flowType: 'pkce'/);

console.log('Recovery-flyt: 12 statiske kontroller besto.');
