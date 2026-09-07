// Local-only PostgreSQL policy regression. Pass the PGlite module path as argv[2].
import { fileURLToPath } from 'node:url';
const { PGlite } = await import(process.argv[2] || '@electric-sql/pglite');
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = readFileSync(`${root}/migrations/2026-08-23_kollektivmatch_hardening.sql`, 'utf8');
const vipps = readFileSync(`${root}/migrations/2026-08-23_vipps_account_verification.sql`, 'utf8');
const reporting = readFileSync(`${root}/migrations/2026-09-01_reporting_hardening.sql`, 'utf8');
const policy = (source, name) => source.match(new RegExp(`create policy "${name}"[\\s\\S]*?;`))[0];
await db.exec(`
  create role anon;
  create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  grant usage on schema public, auth to anon, authenticated;
  create table public.profiles (id uuid primary key, full_name text);
  create table public.listings (id uuid primary key, user_id uuid references public.profiles, status text);
  create table public.messages (listing_id uuid references public.listings, sender_id uuid references public.profiles, receiver_id uuid references public.profiles);
  alter table public.profiles enable row level security;
  alter table public.listings enable row level security;
  alter table public.messages enable row level security;
  grant select(id, full_name) on public.profiles to anon, authenticated;
  grant select(id, user_id, status) on public.listings to anon, authenticated;
  grant select on public.messages to anon, authenticated;
  insert into public.profiles values
    ('10000000-0000-4000-8000-000000000001','Synthetic owner A'),
    ('10000000-0000-4000-8000-000000000002','Synthetic seeker B'),
    ('10000000-0000-4000-8000-000000000003','Synthetic owner C'),
    ('10000000-0000-4000-8000-000000000004','Synthetic bystander D');
  insert into public.listings values
    ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','active'),
    ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','paused'),
    ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','rented'),
    ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','paused');
  insert into public.messages values
    ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001');
`);
await db.exec(policy(baseline, 'Kun avsender og mottaker kan se meldingen'));
await db.exec(policy(baseline, 'Relevant profilinformasjon kan leses'));
await db.exec(policy(vipps, 'Aktive annonser er offentlige og deltakere ser samtaleannonse'));
await db.exec(reporting.match(/revoke select on public\.messages from public, anon;/)[0]);

async function asRole(role, user, callback) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user || '']);
  await db.exec(`set role ${role}`);
  try { return await callback(); } finally { await db.exec('reset role'); }
}
async function expectDenied(sql, label) {
  await assert.rejects(db.query(sql), error => {
    assert.equal(error.code, '42501');
    assert.equal(error.message, 'permission denied for table messages');
    console.log(`${label}: ${error.code} ${error.message}`);
    return true;
  });
}
await asRole('anon', '', async () => {
  await expectDenied('select id from public.listings', 'BEFORE anonymous listing query');
  await expectDenied('select id from public.profiles', 'BEFORE anonymous profile query');
});
const fix = readFileSync(new URL('../migrations/2026-09-07_public_listing_access.sql', import.meta.url), 'utf8');
await db.exec(fix);
await db.exec(fix);
console.log('Migration applies successfully twice (idempotent).');

const suffixes = result => result.rows.map(row => row.id.slice(-1));
await asRole('anon', '', async () => {
  assert.deepEqual(suffixes(await db.query('select id from public.listings order by id')), ['1']);
  assert.deepEqual(suffixes(await db.query('select id from public.profiles order by id')), ['1']);
  await expectDenied('select * from public.messages', 'AFTER anonymous private messages');
  console.log('AFTER anonymous sees only active listing and its owner profile.');
});
await asRole('authenticated', '10000000-0000-4000-8000-000000000002', async () => {
  assert.deepEqual(suffixes(await db.query('select id from public.listings order by id')), ['1','2','4']);
  assert.deepEqual(suffixes(await db.query('select id from public.profiles order by id')), ['1','2']);
  assert.equal((await db.query('select * from public.messages')).rows.length, 1);
  console.log('AFTER participant sees active, conversation and own paused listings; own and relevant profiles; own conversation.');
});
await asRole('authenticated', '10000000-0000-4000-8000-000000000004', async () => {
  assert.deepEqual(suffixes(await db.query('select id from public.listings order by id')), ['1']);
  assert.deepEqual(suffixes(await db.query('select id from public.profiles order by id')), ['1','4']);
  assert.equal((await db.query('select * from public.messages')).rows.length, 0);
  console.log('AFTER unrelated account cannot read paused/rented listings, unrelated profiles or others\' messages.');
});
await db.close();
