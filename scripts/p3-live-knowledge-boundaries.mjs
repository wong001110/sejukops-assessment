// One-shot P3 JWT/RLS integration fixture for the confirmed Sejuk Ops Test project.
// Prepare: node scripts/p3-live-knowledge-boundaries.mjs --prepare --allow-live
// Then execute the generated exact-ID SQL through the trusted Supabase SQL connector.
// Finish: node scripts/p3-live-knowledge-boundaries.mjs --finish --allow-live <run-id>
// Never commit the generated manifest. It contains IDs, not credentials.
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const PROJECT_REF = 'qobhjvrrpajoyvlgrkbx';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEMP = join('supabase', '.temp');
const [mode, approval, runArg] = process.argv.slice(2);
if (approval !== '--allow-live' || !['--prepare', '--finish'].includes(mode) ||
    (mode === '--prepare' && runArg !== undefined) ||
    (mode === '--finish' && !UUID.test(runArg ?? ''))) {
  console.error('Usage: --prepare --allow-live OR --finish --allow-live <run-id>.');
  process.exit(2);
}
process.loadEnvFile('.env');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let parsedUrl;
try { parsedUrl = new URL(url); } catch { /* fail closed */ }
if (parsedUrl?.protocol !== 'https:' || parsedUrl.hostname !== `${PROJECT_REF}.supabase.co` ||
    !publicKey || !serviceKey) {
  console.error(`Refusing live writes: require complete credentials for ${PROJECT_REF}.supabase.co.`);
  process.exit(2);
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, options);
const runId = mode === '--finish' ? runArg : randomUUID();
const manifestPath = join(TEMP, `p3-boundary-${runId}.json`);
const sqlPath = join(TEMP, `p3-boundary-${runId}-cleanup.sql`);
const manifest = mode === '--finish' ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {
  projectRef: PROJECT_REF, runId, status: 'PREPARING',
  users: [], deletedUsers: [], profiles: [], memberships: [], documents: [], versions: [],
};
if (manifest.projectRef !== PROJECT_REF || manifest.runId !== runId ||
    !Array.isArray(manifest.users) || !Array.isArray(manifest.profiles) ||
    !Array.isArray(manifest.memberships) || !Array.isArray(manifest.documents) ||
    !Array.isArray(manifest.versions) || !Array.isArray(manifest.deletedUsers)) {
  console.error('Invalid cleanup manifest.');
  process.exit(2);
}

function uuid(value) {
  if (!UUID.test(value ?? '')) throw new Error('Invalid fixture UUID');
  return value;
}
function save() {
  mkdirSync(TEMP, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'w' });
  writeFileSync(sqlPath, cleanupSql(), { flag: 'w' });
}
function cleanupSql() {
  const statements = [
    '-- Exact-ID P3 cleanup; run only in the confirmed Test project via the trusted SQL connector.',
    `-- Project: ${PROJECT_REF}; run: ${uuid(runId)}.`,
    '-- Execute this entire file atomically before --finish. No Auth user deletion occurs here.',
    'begin;',
  ];
  for (const d of manifest.documents) {
    const wid = uuid(d.workspaceId), did = uuid(d.id), pid = uuid(d.creatorProfileId);
    statements.push(`do $$ begin if not exists (select 1 from public.knowledge_documents where workspace_id = '${wid}'::uuid and id = '${did}'::uuid and created_by_profile_id = '${pid}'::uuid and title = 'P3 temporary ${uuid(runId)}') then raise exception 'P3 cleanup document identity mismatch'; end if; end $$;`);
    statements.push(`update public.knowledge_documents set state = 'DRAFT', published_version_id = null where workspace_id = '${wid}'::uuid and id = '${did}'::uuid;`);
    statements.push(`delete from public.knowledge_chunks where workspace_id = '${wid}'::uuid and document_id = '${did}'::uuid;`);
    statements.push(`delete from public.knowledge_versions where workspace_id = '${wid}'::uuid and document_id = '${did}'::uuid;`);
    statements.push(`delete from public.knowledge_documents where workspace_id = '${wid}'::uuid and id = '${did}'::uuid;`);
  }
  for (const m of [...manifest.memberships].reverse()) {
    statements.push(`delete from public.workspace_memberships where workspace_id = '${uuid(m.workspaceId)}'::uuid and profile_id = '${uuid(m.profileId)}'::uuid;`);
  }
  for (const p of [...manifest.profiles].reverse()) {
    statements.push(`delete from public.profiles where id = '${uuid(p.id)}'::uuid and auth_user_id = '${uuid(p.authUserId)}'::uuid and display_name = 'P3 temporary ${uuid(runId)}';`);
  }
  statements.push('commit;');
  statements.push(`-- Then: node scripts/p3-live-knowledge-boundaries.mjs --finish --allow-live ${uuid(runId)}`);
  return statements.join('\n') + '\n';
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
function denied(result, label) { check(Boolean(result.error), label); }
async function temporaryUser(label, role, workspaceId) {
  const email = `p3-${label}-${randomBytes(8).toString('hex')}@example.invalid`;
  const password = randomBytes(36).toString('base64url');
  const user = data(await admin.auth.admin.createUser({ email, password, email_confirm: true }), `create Auth ${label}`).user;
  if (!UUID.test(user?.id ?? '')) throw new Error(`create Auth ${label}: NO_USER`);
  manifest.users.push(user.id); save();
  const profileId = randomUUID();
  manifest.profiles.push({ id: profileId, authUserId: user.id }); save();
  data(await admin.from('profiles').insert({
    id: profileId, auth_user_id: user.id, display_name: `P3 temporary ${runId}`,
    role, platform_role: 'USER', active: true,
  }).select('id').single(), `create profile ${label}`);
  manifest.memberships.push({ workspaceId, profileId }); save();
  data(await admin.from('workspace_memberships').insert({
    workspace_id: workspaceId, profile_id: profileId, role, active: true,
  }).select('profile_id').single(), `create membership ${label}`);
  const client = createClient(url, publicKey, options);
  const session = data(await client.auth.signInWithPassword({ email, password }), `sign in ${label}`);
  check(session.user?.id === user.id && Boolean(session.session?.access_token), `${label} has own JWT`);
  return { client, profileId };
}
async function createDocument(actor, workspace, label) {
  const id = uuid(data(await actor.client.rpc('knowledge_create_document', {
    p_workspace_id: workspace.id, p_generation: workspace.generation,
    p_title: `P3 temporary ${runId}`, p_source_label: `Fictional ${label} source`,
  }), `create ${label} draft`));
  manifest.documents.push({ id, workspaceId: workspace.id, creatorProfileId: actor.profileId }); save();
  return id;
}
async function stage(actor, workspace, documentId, source) {
  const id = uuid(data(await actor.client.rpc('knowledge_stage_text', {
    p_workspace_id: workspace.id, p_generation: workspace.generation,
    p_document_id: documentId, p_source_text: source, p_chunks: [source],
  }), 'stage text'));
  manifest.versions.push({ id, workspaceId: workspace.id, documentId }); save();
  return id;
}

async function prepare() {
  if (existsSync(manifestPath)) throw new Error('Manifest already exists');
  save();
  const demo = data(await admin.from('workspaces').select('id,generation').eq('kind', 'DEMO').single(), 'Demo workspace');
  const owner = data(await admin.from('workspaces').select('id,generation').eq('kind', 'OWNER').single(), 'Owner workspace');
  uuid(demo.id); uuid(owner.id);
  if (!Number.isSafeInteger(demo.generation) || demo.generation < 1 ||
      !Number.isSafeInteger(owner.generation) || owner.generation < 1) throw new Error('Invalid workspace generation');
  check(demo.id !== owner.id, 'distinct Demo and Owner workspaces');
  const creator = await temporaryUser('demo-creator', 'ADMIN', demo.id);
  const peer = await temporaryUser('demo-peer', 'MANAGER', demo.id);
  const ownerActor = await temporaryUser('owner-creator', 'ADMIN', owner.id);
  const demoDocument = await createDocument(creator, demo, 'Demo');
  const source = `Fictional compressor note ${runId}: cool the test unit before service.`;
  const demoVersion = await stage(creator, demo, demoDocument, source);
  const creatorDraft = data(await creator.client.from('knowledge_documents').select('id').eq('id', demoDocument), 'creator draft read');
  check(creatorDraft.some(row => row.id === demoDocument), 'creator sees own draft');
  const peerDraft = data(await peer.client.from('knowledge_documents').select('id').eq('id', demoDocument), 'peer draft read');
  const peerVersion = data(await peer.client.from('knowledge_versions').select('id').eq('id', demoVersion), 'peer version read');
  const peerChunks = data(await peer.client.from('knowledge_chunks').select('version_id').eq('version_id', demoVersion), 'peer chunk read');
  check(!peerDraft.length && !peerVersion.length && !peerChunks.length, 'Demo peer cannot see unpublished draft/version/chunks');
  const ownerDraft = data(await ownerActor.client.from('knowledge_documents').select('id').eq('id', demoDocument), 'Owner draft read');
  check(!ownerDraft.length, 'Owner cannot read Demo draft');
  const before = data(await peer.client.rpc('knowledge_search_keyword', { p_workspace_id: demo.id, p_query: 'compressor' }), 'prepublish search');
  check(!before.some(row => row.document_id === demoDocument), 'draft is not searchable');
  denied(await creator.client.rpc('knowledge_create_document', {
    p_workspace_id: owner.id, p_generation: owner.generation,
    p_title: `P3 temporary ${runId}`, p_source_label: 'Cross workspace',
  }), 'Demo creator cannot create Owner draft');
  denied(await peer.client.rpc('knowledge_stage_text', {
    p_workspace_id: demo.id, p_generation: demo.generation, p_document_id: demoDocument,
    p_source_text: 'Peer overwrite', p_chunks: ['Peer overwrite'],
  }), 'Demo peer cannot stage creator draft');
  denied(await peer.client.rpc('knowledge_publish', {
    p_workspace_id: demo.id, p_generation: demo.generation,
    p_document_id: demoDocument, p_version_id: demoVersion,
  }), 'Demo peer cannot publish creator draft');
  denied(await creator.client.rpc('knowledge_publish', {
    p_workspace_id: demo.id, p_generation: demo.generation - 1,
    p_document_id: demoDocument, p_version_id: demoVersion,
  }), 'stale generation cannot publish');
  denied(await creator.client.from('knowledge_documents').insert({
    workspace_id: demo.id, generation: demo.generation, title: 'Direct write',
    source_label: 'Direct write', created_by_profile_id: creator.profileId,
  }), 'authenticated direct table write denied');

  const ownerDocument = await createDocument(ownerActor, owner, 'Owner');
  const ownerSource = `Fictional owner-only valve note ${runId}.`;
  const ownerVersion = await stage(ownerActor, owner, ownerDocument, ownerSource);
  denied(await creator.client.rpc('knowledge_publish', {
    p_workspace_id: demo.id, p_generation: demo.generation,
    p_document_id: demoDocument, p_version_id: ownerVersion,
  }), 'cross-workspace version substitution denied');
  ok(await creator.client.rpc('knowledge_publish', {
    p_workspace_id: demo.id, p_generation: demo.generation,
    p_document_id: demoDocument, p_version_id: demoVersion,
  }), 'publish Demo version');
  ok(await ownerActor.client.rpc('knowledge_publish', {
    p_workspace_id: owner.id, p_generation: owner.generation,
    p_document_id: ownerDocument, p_version_id: ownerVersion,
  }), 'publish Owner version');
  const demoHits = data(await peer.client.rpc('knowledge_search_keyword', { p_workspace_id: demo.id, p_query: 'compressor' }), 'Demo search');
  check(demoHits.some(row => row.document_id === demoDocument && row.version_id === demoVersion && row.content === source),
    'Demo peer retrieves published version with scoped citation');
  const wrongHits = data(await creator.client.rpc('knowledge_search_keyword', { p_workspace_id: owner.id, p_query: 'valve' }), 'cross-workspace search');
  check(!wrongHits.some(row => row.document_id === ownerDocument), 'Demo creator cannot search Owner knowledge');
  const ownerRows = data(await ownerActor.client.from('knowledge_documents').select('id'), 'Owner document read');
  check(ownerRows.some(row => row.id === ownerDocument) && !ownerRows.some(row => row.id === demoDocument),
    'Owner cannot read Demo published document');
  denied(await creator.client.rpc('knowledge_stage_text', {
    p_workspace_id: demo.id, p_generation: demo.generation, p_document_id: demoDocument,
    p_source_text: source, p_chunks: [source],
  }), 'duplicate import rejected while old published version stays active');
  const afterFailed = data(await peer.client.rpc('knowledge_search_keyword', { p_workspace_id: demo.id, p_query: 'compressor' }), 'search after failed replacement');
  check(afterFailed.some(row => row.version_id === demoVersion), 'failed replacement preserves published version');
  ok(await creator.client.rpc('knowledge_archive', {
    p_workspace_id: demo.id, p_generation: demo.generation, p_document_id: demoDocument,
  }), 'archive Demo document');
  const afterArchive = data(await peer.client.rpc('knowledge_search_keyword', { p_workspace_id: demo.id, p_query: 'compressor' }), 'search after archive');
  check(!afterArchive.some(row => row.document_id === demoDocument), 'archived content is not searchable');
  const noAuth = createClient(url, publicKey, options);
  denied(await noAuth.from('knowledge_documents').select('id'), 'unauthenticated document read denied');
  denied(await noAuth.rpc('knowledge_search_keyword', { p_workspace_id: demo.id, p_query: 'compressor' }),
    'unauthenticated search RPC denied');
  manifest.status = 'NEEDS_SQL_CLEANUP'; save();
  console.log(`PASS ${checks} live checks. Execute exact-ID SQL via confirmed Test connector: ${sqlPath}`);
  console.log(`After SQL succeeds, run: node scripts/p3-live-knowledge-boundaries.mjs --finish --allow-live ${runId}`);
}

async function finish() {
  if (manifest.status !== 'NEEDS_SQL_CLEANUP') throw new Error('Manifest is not ready for cleanup');
  const ids = manifest.profiles.map(row => uuid(row.id));
  if (ids.length) {
    const profiles = data(await admin.from('profiles').select('id').in('id', ids), 'verify SQL profile cleanup');
    if (profiles.length) throw new Error('SQL cleanup incomplete: temporary profiles still exist');
  }
  for (const id of manifest.users) {
    if (manifest.deletedUsers.includes(id)) continue;
    const { error } = await admin.auth.admin.deleteUser(uuid(id));
    if (error) throw new Error(`Auth cleanup failed: ${error.code ?? error.status ?? 'UNKNOWN'}`);
    manifest.deletedUsers.push(id); save();
  }
  manifest.status = 'CLEANED'; save();
  console.log(`PASS temporary Auth users removed for P3 run ${runId}.`);
}

try {
  if (mode === '--prepare') await prepare(); else await finish();
} catch (error) {
  if (mode === '--prepare') {
    manifest.status = 'NEEDS_SQL_CLEANUP';
    try { save(); } catch { /* report the original error and manifest path */ }
  }
  console.error(`FAIL P3 live boundary: ${error instanceof Error ? error.message : 'UNKNOWN'}`);
  console.error(`Fixture manifest: ${manifestPath}; exact-ID cleanup SQL: ${sqlPath}`);
  process.exitCode = 1;
}
