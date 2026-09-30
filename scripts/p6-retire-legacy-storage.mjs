// One-shot cleanup for the confirmed Sejuk Ops Test project's assessment files.
// Default: read-only exact-path inventory. Write mode: pass exactly --allow-live.
// This script is never invoked by tests, build, migrations, or app runtime.
// The snapshot IDs below were read from storage.objects on 2026-09-29. A changed
// inventory blocks write mode; review the new inventory before updating them.
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const PROJECT_REF = 'qobhjvrrpajoyvlgrkbx';
const EXPECTED = Object.freeze({
  documents: {
    count: 9,
    sha256: '86aaf0e42ad89a794db12649435a4affd4142070bfb50df4348f611337a5a5e3',
  },
  'service-evidence': {
    count: 7,
    sha256: '126c50322ed38395e057488271ee9eeddae923f2be481cc2031e3717bf0229ea',
  },
});
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--allow-live')) {
  console.error('Usage: node scripts/p6-retire-legacy-storage.mjs [--allow-live]');
  process.exit(2);
}
const allowLive = args[0] === '--allow-live';

process.loadEnvFile('.env');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
let parsed;
try { parsed = new URL(url); } catch { /* fail closed below */ }
if (parsed?.protocol !== 'https:' || parsed.hostname !== `${PROJECT_REF}.supabase.co`
    || parsed.pathname !== '/' || parsed.search || parsed.hash || !key) {
  console.error(`Refusing access: require credentials for ${PROJECT_REF}.supabase.co.`);
  process.exit(2);
}

const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function dataOrThrow(result, action) {
  if (result.error || result.data == null) {
    throw new Error(`${action}: ${result.error?.code ?? result.error?.status ?? 'NO_DATA'}`);
  }
  return result.data;
}

async function inventoryBucket(bucket) {
  const entries = [];
  const seen = new Set();
  async function walk(prefix = '') {
    for (let offset = 0; ; offset += 100) {
      const page = dataOrThrow(await client.storage.from(bucket).list(prefix, {
        limit: 100, offset, sortBy: { column: 'name', order: 'asc' },
      }), `list ${bucket}`);
      for (const item of page) {
        if (typeof item.name !== 'string' || !item.name || item.name === '.'
            || item.name === '..' || item.name.includes('/')) {
          throw new Error(`Unexpected Storage path segment in ${bucket}`);
        }
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id == null) {
          await walk(path);
          continue;
        }
        if (typeof item.id !== 'string' || seen.has(path)) {
          throw new Error(`Invalid or duplicate Storage object in ${bucket}`);
        }
        seen.add(path);
        entries.push({ path, id: item.id });
      }
      if (page.length < 100) break;
    }
  }
  await walk();
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1
    : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const snapshot = entries.map(({ path, id }) => `${bucket}\n${path}\n${id}`).join('\n');
  const sha256 = createHash('sha256').update(snapshot).digest('hex');
  return { bucket, entries, sha256 };
}

async function main() {
  const buckets = dataOrThrow(await client.storage.listBuckets(), 'list buckets');
  const inventories = [];
  for (const bucket of Object.keys(EXPECTED)) {
    const record = buckets.find((candidate) => candidate.id === bucket);
    if (!record || record.public !== false) {
      throw new Error(`Expected private legacy bucket missing or changed: ${bucket}`);
    }
    const inventory = await inventoryBucket(bucket);
    inventories.push(inventory);
    console.log(`${bucket}: ${inventory.entries.length} objects, sha256=${inventory.sha256}`);
    for (const item of inventory.entries) console.log(`  ${item.path}`);
  }
  const matching = inventories.every(({ bucket, entries, sha256 }) =>
    entries.length === EXPECTED[bucket].count && sha256 === EXPECTED[bucket].sha256);
  if (!allowLive) {
    console.log(matching ? 'DRY RUN: snapshot matches; no objects changed.'
      : 'DRY RUN: snapshot changed; review before any deletion.');
    return;
  }
  if (!matching) throw new Error('Refusing deletion: Storage inventory differs from reviewed snapshot.');

  // Recheck both complete inventories immediately before the first mutation.
  for (const prior of inventories) {
    const current = await inventoryBucket(prior.bucket);
    if (current.entries.length !== prior.entries.length || current.sha256 !== prior.sha256) {
      throw new Error(`Refusing deletion: ${prior.bucket} changed during preflight.`);
    }
  }
  for (const { bucket, entries } of inventories) {
    for (let start = 0; start < entries.length; start += 100) {
      const paths = entries.slice(start, start + 100).map(({ path }) => path);
      dataOrThrow(await client.storage.from(bucket).remove(paths), `remove ${bucket} objects`);
    }
    const remaining = await inventoryBucket(bucket);
    if (remaining.entries.length !== 0) {
      throw new Error(`${bucket} still contains objects; bucket retained for review.`);
    }
    dataOrThrow(await client.storage.deleteBucket(bucket), `delete ${bucket} bucket`);
    console.log(`DELETED ${bucket}: ${entries.length} reviewed objects and empty bucket.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Unknown Storage cleanup error');
  process.exitCode = 1;
});
