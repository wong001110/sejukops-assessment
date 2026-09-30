// Bounded KB-02 real-JWT Demo evaluation for confirmed Sejuk Ops Test.
// Prepare: node scripts/p3-live-kb-lexical.mjs --prepare --allow-live
// Execute generated exact-ID SQL through the trusted Supabase connector.
// Finish: node scripts/p3-live-kb-lexical.mjs --finish --allow-live <run-id>
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const REF = 'qobhjvrrpajoyvlgrkbx';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const [mode, approval, requestedRun] = process.argv.slice(2);
if (approval !== '--allow-live' || !['--prepare', '--finish'].includes(mode) ||
    (mode === '--prepare' && requestedRun !== undefined) ||
    (mode === '--finish' && !UUID.test(requestedRun ?? ''))) {
  console.error('Usage: --prepare --allow-live OR --finish --allow-live <run-id>.');
  process.exit(2);
}
process.loadEnvFile('.env');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let parsedUrl;
try { parsedUrl = new URL(url); } catch { /* fail closed */ }
if (parsedUrl?.protocol !== 'https:' || parsedUrl.hostname !== `${REF}.supabase.co` ||
    !publicKey || !serviceKey) {
  console.error(`Refusing live fixture outside confirmed ${REF}.supabase.co.`);
  process.exit(2);
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, options);
const runId = mode === '--finish' ? requestedRun : randomUUID();
const temp = join('supabase', '.temp');
const manifestPath = join(temp, `kb-lexical-${runId}.json`);
const sqlPath = join(temp, `kb-lexical-${runId}-cleanup.sql`);
const manifest = mode === '--finish' ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {
  projectRef: REF, runId, status: 'PREPARING', authUserId: null,
  profileId: null, workspaceId: null, documents: [],
};
if (manifest.projectRef !== REF || manifest.runId !== runId ||
    !Array.isArray(manifest.documents)) throw new Error('Invalid cleanup manifest');
function uuid(value) {
  if (!UUID.test(value ?? '')) throw new Error('Invalid fixture UUID');
  return value;
}
function cleanupSql() {
  const lines = [
    `-- Exact-ID KB-02 cleanup in confirmed ${REF}; run ${uuid(runId)}.`,
    'begin;',
  ];
  for (const documentId of manifest.documents) {
    const wid = uuid(manifest.workspaceId), did = uuid(documentId), pid = uuid(manifest.profileId);
    lines.push(`do $$ begin if not exists (select 1 from public.knowledge_documents where workspace_id = '${wid}'::uuid and id = '${did}'::uuid and created_by_profile_id = '${pid}'::uuid and title = 'KB lexical ${uuid(runId)}') then raise exception 'KB fixture identity mismatch'; end if; end $$;`);
    lines.push(`update public.knowledge_documents set state = 'DRAFT', published_version_id = null where workspace_id = '${wid}'::uuid and id = '${did}'::uuid;`);
    lines.push(`delete from public.knowledge_chunks where workspace_id = '${wid}'::uuid and document_id = '${did}'::uuid;`);
    lines.push(`delete from public.knowledge_version_pages where workspace_id = '${wid}'::uuid and document_id = '${did}'::uuid;`);
    lines.push(`delete from public.knowledge_versions where workspace_id = '${wid}'::uuid and document_id = '${did}'::uuid;`);
    lines.push(`delete from public.knowledge_documents where workspace_id = '${wid}'::uuid and id = '${did}'::uuid;`);
  }
  if (manifest.profileId) {
    const wid = uuid(manifest.workspaceId), pid = uuid(manifest.profileId), uid = uuid(manifest.authUserId);
    lines.push(`delete from public.workspace_memberships where workspace_id = '${wid}'::uuid and profile_id = '${pid}'::uuid;`);
    lines.push(`delete from public.profiles where id = '${pid}'::uuid and auth_user_id = '${uid}'::uuid and display_name = 'KB lexical ${uuid(runId)}';`);
  }
  lines.push('commit;');
  return lines.join('\n') + '\n';
}
function save() {
  mkdirSync(temp, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(sqlPath, cleanupSql());
}
function data(result, label) {
  if (result.error || result.data == null) throw new Error(`${label}: ${result.error?.code ?? result.error?.status ?? 'NO_DATA'}`);
  return result.data;
}
function ok(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.code ?? result.error.status ?? 'UNKNOWN'}`);
}
let checks = 0;
function check(condition, label) {
  if (!condition) throw new Error(`${label}: unexpected result`);
  checks++;
  console.log(`PASS ${label}`);
}
async function createDocument(client, workspace, source, finishState) {
  const id = uuid(data(await client.rpc('knowledge_create_document', {
    p_workspace_id: workspace.id, p_generation: workspace.generation,
    p_title: `KB lexical ${runId}`, p_source_label: `Fictional KB ${runId}`,
  }), 'create document'));
  manifest.documents.push(id); save();
  const chunks = Array.isArray(source) ? source : [source];
  const full = chunks.join('');
  const versionId = uuid(data(await client.rpc('knowledge_stage_text', {
    p_workspace_id: workspace.id, p_generation: workspace.generation,
    p_document_id: id, p_source_text: full, p_chunks: chunks,
  }), 'stage text'));
  if (finishState !== 'DRAFT') {
    const args = { p_workspace_id: workspace.id, p_generation: workspace.generation,
      p_document_id: id, p_version_id: versionId };
    const pages = data(await client.rpc('knowledge_claim_index', args), 'claim index');
    check(pages.length === 1 && pages[0].page_text === full && UUID.test(pages[0].token), 'index claim binds source page');
    if (finishState === 'FAILED') {
      ok(await client.rpc('knowledge_fail_index', { ...args,
        p_token: pages[0].token, p_error_code: 'INDEX_FAILED' }), 'fail index');
    } else {
      ok(await client.rpc('knowledge_finish_index', { ...args,
        p_token: pages[0].token, p_page_numbers: chunks.map(() => 1), p_contents: chunks }), 'finish index');
      ok(await client.rpc('knowledge_publish', args), 'publish version');
    }
  }
  return { id, versionId };
}
async function search(client, workspaceId, query) {
  return data(await client.rpc('knowledge_search_keyword', {
    p_workspace_id: workspaceId, p_query: query, p_limit: 20,
  }), `search ${query}`);
}
async function prepare() {
  if (existsSync(manifestPath)) throw new Error('Manifest already exists');
  save();
  const demo = data(await admin.from('workspaces').select('id,generation')
    .eq('kind', 'DEMO').single(), 'Demo workspace');
  uuid(demo.id);
  if (!Number.isSafeInteger(demo.generation) || demo.generation < 1) throw new Error('Invalid Demo generation');
  const email = `kb-lexical-${randomBytes(8).toString('hex')}@example.invalid`;
  const password = randomBytes(36).toString('base64url');
  const user = data(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'create Auth').user;
  manifest.authUserId = uuid(user.id); save();
  manifest.workspaceId = demo.id;
  manifest.profileId = randomUUID(); save();
  data(await admin.from('profiles').insert({
    id: manifest.profileId, auth_user_id: user.id, display_name: `KB lexical ${runId}`,
    role: 'ADMIN', platform_role: 'USER', active: true,
  }).select('id').single(), 'create profile');
  data(await admin.from('workspace_memberships').insert({
    workspace_id: demo.id, profile_id: manifest.profileId, role: 'ADMIN', active: true,
  }).select('profile_id').single(), 'create Demo membership');
  const client = createClient(url, publicKey, options);
  const session = data(await client.auth.signInWithPassword({ email, password }), 'sign in');
  check(session.user?.id === user.id && Boolean(session.session?.access_token), 'temporary Demo actor has real JWT');

  const chunks = [
    'Replace the filter every 90 days. ',
    'QX-731 means inspect the condenser. ',
    '每九十天更换滤芯。',
  ];
  const published = await createDocument(client, demo, chunks, 'PUBLISHED');
  const draft = await createDocument(client, demo, 'Draft cartridge replacement only.', 'DRAFT');
  const failed = await createDocument(client, demo, 'Failed cartridge replacement only.', 'FAILED');
  for (const [query, expectedOrdinal, label] of [
    ['when should the cartridge be changed?', 1, 'English paraphrase'],
    ['when do I change the cartridge?', 1, 'English wording variation'],
    ['change cartridge', 1, 'English symmetric synonym'],
    ['QX-731', 2, 'exact identifier'],
    ['更换滤芯', 3, 'Chinese literal'],
  ]) {
    const hits = await search(client, demo.id, query);
    check(hits.some(row => row.document_id === published.id && row.version_id === published.versionId &&
      row.ordinal === expectedOrdinal && row.page_no === 1 && row.section_label === `Page 1, section ${expectedOrdinal}` &&
      row.workspace_id === demo.id), `${label} resolves scoped citation`);
  }
  for (const query of ['QX-999', 'inspect the evaporator', 'when should the', 'cartridge replacement']) {
    const hits = await search(client, demo.id, query);
    check(!hits.some(row => row.document_id === published.id && query !== 'cartridge replacement') &&
      !hits.some(row => row.document_id === draft.id || row.document_id === failed.id),
      `${query} has no forbidden or unsupported hit`);
  }
  const wrongWorkspace = await search(client, randomUUID(), 'cartridge changed');
  check(wrongWorkspace.length === 0, 'wrong workspace returns no knowledge');
  const stale = await client.rpc('knowledge_create_document', {
    p_workspace_id: demo.id, p_generation: demo.generation - 1,
    p_title: `KB lexical ${runId}`, p_source_label: 'Fictional stale',
  });
  check(Boolean(stale.error), 'stale generation cannot create document');
  const versions = data(await client.from('knowledge_versions').select('id,index_state')
    .in('id', [published.versionId, failed.versionId]), 'read version states');
  check(versions.some(row => row.id === published.versionId && row.index_state === 'READY') &&
    versions.some(row => row.id === failed.versionId && row.index_state === 'FAILED'),
  'published READY and failed version remain distinct');
  manifest.status = 'NEEDS_SQL_CLEANUP'; save();
  console.log(`PASS ${checks} real-JWT Demo checks. Exact-ID cleanup SQL: ${sqlPath}`);
  console.log(`Then run: node scripts/p3-live-kb-lexical.mjs --finish --allow-live ${runId}`);
}
async function finish() {
  if (manifest.status !== 'NEEDS_SQL_CLEANUP') throw new Error('Manifest is not ready for cleanup');
  const profile = data(await admin.from('profiles').select('id')
    .eq('id', uuid(manifest.profileId)), 'verify profile cleanup');
  if (profile.length) throw new Error('SQL cleanup incomplete: profile remains');
  // The confirmed project's service role deliberately has no direct SELECT
  // grant on knowledge tables. Verify document/version/page/chunk counts via
  // the trusted SQL connector before running --finish.
  const { error } = await admin.auth.admin.deleteUser(uuid(manifest.authUserId));
  if (error) throw new Error(`Auth cleanup failed: ${error.code ?? error.status ?? 'UNKNOWN'}`);
  manifest.status = 'CLEANED'; save();
  console.log(`PASS exact-ID SQL and Auth cleanup for ${runId}.`);
}
try {
  if (mode === '--prepare') await prepare(); else await finish();
} catch (error) {
  if (mode === '--prepare') {
    manifest.status = 'NEEDS_SQL_CLEANUP';
    try { save(); } catch { /* preserve original error */ }
  }
  console.error(`FAIL KB lexical: ${error instanceof Error ? error.message : 'UNKNOWN'}`);
  console.error(`Fixture manifest: ${manifestPath}; cleanup SQL: ${sqlPath}`);
  process.exitCode = 1;
}
