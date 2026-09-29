// One-shot real HTTP/DB PDF route check for the confirmed Sejuk Ops Test project.
// Run against a locally started Next server: node scripts/p3-live-knowledge-pdf.mjs --run --allow-live http://127.0.0.1:3100
// Execute the generated exact-ID cleanup SQL through the trusted Test connector,
// Verify zero exact-ID SQL rows through that connector, then:
// node scripts/p3-live-knowledge-pdf.mjs --finish --allow-live <run-id> --sql-verified
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const PROJECT_REF = 'qobhjvrrpajoyvlgrkbx';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const [mode, approval, arg, sqlVerified] = process.argv.slice(2);
if (approval !== '--allow-live' || !['--run', '--finish'].includes(mode) ||
    (mode === '--finish' && (!UUID.test(arg ?? '') || sqlVerified !== '--sql-verified')) ||
    (mode === '--run' && (sqlVerified !== undefined || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(arg ?? '')))) {
  console.error('Usage: --run --allow-live http://127.0.0.1:<port> OR --finish --allow-live <run-id> --sql-verified');
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
const runId = mode === '--run' ? randomUUID() : arg;
const temp = join('supabase', '.temp');
const manifestPath = join(temp, `p3-pdf-${runId}.json`);
const sqlPath = join(temp, `p3-pdf-${runId}-cleanup.sql`);
const manifest = mode === '--run' ? { projectRef: PROJECT_REF, runId, status: 'PREPARING',
  authUserId: null, profileId: null, membershipId: null, workspaceId: null,
  documentId: null, versionId: null } : JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.projectRef !== PROJECT_REF || manifest.runId !== runId) throw new Error('Fixture identity mismatch');

function requiredUuid(value) {
  if (!UUID.test(value ?? '')) throw new Error('Invalid fixture UUID');
  return value;
}
function save() {
  mkdirSync(temp, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const { workspaceId, documentId, profileId, authUserId } = manifest;
  if (workspaceId && profileId && authUserId) {
    const w = requiredUuid(workspaceId);
    const p = requiredUuid(profileId), a = requiredUuid(authUserId);
    const documentSql = documentId ? (() => {
      const d = requiredUuid(documentId);
      return `do $$ begin if not exists (select 1 from public.knowledge_documents where id = '${d}'::uuid and workspace_id = '${w}'::uuid and created_by_profile_id = '${p}'::uuid and title = 'P3 PDF temporary ${runId}') then raise exception 'PDF cleanup document mismatch'; end if; end $$;\n` +
        `delete from public.knowledge_chunks where workspace_id = '${w}'::uuid and document_id = '${d}'::uuid;\n` +
        `delete from public.knowledge_version_pages where workspace_id = '${w}'::uuid and document_id = '${d}'::uuid;\n` +
        `delete from public.knowledge_versions where workspace_id = '${w}'::uuid and document_id = '${d}'::uuid;\n` +
        `delete from public.knowledge_documents where workspace_id = '${w}'::uuid and id = '${d}'::uuid;\n`;
    })() : '';
    writeFileSync(sqlPath, `-- Exact-ID cleanup for fictional P3 PDF fixture in confirmed Test project only.\n` +
      `begin;\n` +
      documentSql +
      `delete from public.workspace_memberships where workspace_id = '${w}'::uuid and profile_id = '${p}'::uuid;\n` +
      `delete from public.profiles where id = '${p}'::uuid and auth_user_id = '${a}'::uuid and display_name = 'P3 PDF temporary ${runId}';\n` +
      `commit;\n`);
  }
}
function data(result, label) {
  if (result.error || result.data == null) throw new Error(`${label}: ${result.error?.code ?? result.error?.status ?? 'NO_DATA'}`);
  return result.data;
}
let checks = 0;
function check(condition, label) {
  if (!condition) throw new Error(`${label}: unexpected result`);
  checks++;
  console.log(`PASS ${label}`);
}
async function run() {
  if (existsSync(manifestPath)) throw new Error('Manifest already exists');
  save();
  const demo = data(await admin.from('workspaces').select('id,generation').eq('kind', 'DEMO').single(), 'Demo');
  const owner = data(await admin.from('workspaces').select('id').eq('kind', 'OWNER').single(), 'Owner');
  manifest.workspaceId = requiredUuid(demo.id); save();
  const email = `p3-pdf-${randomBytes(10).toString('hex')}@example.invalid`;
  const password = randomBytes(36).toString('base64url');
  const user = data(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'create Auth').user;
  manifest.authUserId = requiredUuid(user.id); save();
  manifest.profileId = randomUUID(); save();
  data(await admin.from('profiles').insert({ id: manifest.profileId, auth_user_id: user.id,
    display_name: `P3 PDF temporary ${runId}`, role: 'ADMIN', platform_role: 'USER', active: true })
    .select('id').single(), 'create profile');
  data(await admin.from('workspace_memberships').insert({ workspace_id: demo.id,
    profile_id: manifest.profileId, role: 'ADMIN', active: true })
    .select('profile_id').single(), 'create membership');
  const client = createClient(url, publicKey, options);
  const session = data(await client.auth.signInWithPassword({ email, password }), 'sign in');
  check(session.user?.id === user.id && Boolean(session.session?.access_token), 'temporary Demo Admin has real JWT');
  const jar = new Map();
  const ssr = createServerClient(url, publicKey, { cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: entries => entries.forEach(({ name, value }) => value ? jar.set(name, value) : jar.delete(name)),
  } });
  data(await ssr.auth.setSession({ access_token: session.session.access_token,
    refresh_token: session.session.refresh_token }), 'prepare HTTP session');
  const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  check(cookie.length > 0, 'SSR session cookie prepared');
  const origin = new URL(arg).origin;
  const authenticatedRead = await fetch(`${origin}/api/workspaces/${demo.id}/knowledge`,
    { headers: { Cookie: cookie } });
  check(authenticatedRead.status === 200,
    `authenticated knowledge route status ${authenticatedRead.status}; cookie names ${[...jar.keys()].join(',')}; project ${PROJECT_REF}`);
  const pdfBytes = Buffer.from(readFileSync('tests/fixtures/documents/complete-service-invoice.pdf.base64', 'utf8').trim(), 'base64');
  const endpoint = id => `${origin}/api/workspaces/${id}/knowledge/pdf`;
  function form(type = 'application/pdf', bytes = pdfBytes) {
    const value = new FormData();
    value.set('file', new Blob([bytes], { type }), 'fictional-guide.pdf');
    value.set('documentId', manifest.documentId);
    value.set('generation', String(demo.generation));
    return value;
  }
  async function post(workspaceId, body, requestOrigin = origin) {
    return fetch(endpoint(workspaceId), { method: 'POST', headers: { Cookie: cookie, Origin: requestOrigin }, body });
  }
  manifest.documentId = requiredUuid(data(await client.rpc('knowledge_create_document', {
    p_workspace_id: demo.id, p_generation: demo.generation,
    p_title: `P3 PDF temporary ${runId}`, p_source_label: 'Fictional PDF fixture',
  }), 'create draft'));
  save();
  check(Boolean((await client.rpc('knowledge_stage_pdf_text', {
    p_workspace_id: demo.id, p_generation: demo.generation,
    p_document_id: manifest.documentId, p_pages: ['Forged PDF page'],
  })).error), 'old direct PDF_TEXT RPC is unavailable');
  check(Boolean((await client.rpc('knowledge_issue_pdf_attestation', {
    p_actor_auth_user_id: user.id, p_workspace_id: demo.id,
    p_generation: demo.generation, p_document_id: manifest.documentId,
    p_pages: ['Forged PDF page'],
  })).error), 'authenticated caller cannot issue PDF attestation');
  check(Boolean((await client.rpc('knowledge_consume_pdf_attestation', {
    p_token: randomUUID(), p_pages: ['Forged PDF page'],
  })).error), 'unissued PDF attestation is denied');
  check((await post(owner.id, form())).status === 403, 'Demo actor denied Owner PDF route');
  check((await post(demo.id, form(), 'https://other.example.invalid')).status === 403,
    'foreign Origin denied');
  const unsupported = await post(demo.id, form('text/plain'));
  check(unsupported.status === 400, `unsupported media type status ${unsupported.status}`);
  check((await post(demo.id, form('application/pdf', Buffer.alloc(5 * 1024 * 1024 + 1)))).status === 400,
    'oversized PDF denied');
  const success = await post(demo.id, form());
  const payload = await success.json();
  check(success.status === 201 && UUID.test(payload.versionId ?? '') && payload.pages === 1,
    'text-native PDF staged through HTTP');
  manifest.versionId = requiredUuid(payload.versionId); save();
  const version = data(await client.from('knowledge_versions').select('source_kind,index_state,source_text')
    .eq('id', manifest.versionId).single(), 'version read');
  const pages = data(await client.from('knowledge_version_pages').select('page_no,content')
    .eq('version_id', manifest.versionId), 'page read');
  check(version.source_kind === 'PDF_TEXT' && version.index_state === 'PENDING' &&
    version.source_text.includes('FICTIONAL SERVICE INVOICE') && pages.length === 1 &&
    pages[0].page_no === 1 && pages[0].content.includes('FICTIONAL SERVICE INVOICE'),
  'page text and source kind persisted with pending index');
  manifest.status = 'NEEDS_SQL_CLEANUP'; save();
  console.log(`PASS ${checks} live checks. Execute exact-ID SQL through Test connector: ${sqlPath}`);
  console.log(`After exact-ID SQL readback is zero: node scripts/p3-live-knowledge-pdf.mjs --finish --allow-live ${runId} --sql-verified`);
}
async function finish() {
  if (manifest.status !== 'NEEDS_SQL_CLEANUP') throw new Error('Fixture is not ready for finish');
  requiredUuid(manifest.profileId); requiredUuid(manifest.documentId);
  console.log('PASS exact-ID SQL cleanup was verified through the trusted Test connector');
  const { error } = await admin.auth.admin.deleteUser(requiredUuid(manifest.authUserId));
  if (error) throw new Error(`Auth cleanup: ${error.code ?? error.status ?? 'UNKNOWN'}`);
  manifest.status = 'CLEANED'; save();
  console.log(`PASS temporary Auth user removed for P3 PDF run ${runId}.`);
}
try { if (mode === '--run') await run(); else await finish(); }
catch (error) {
  if (mode === '--run') { manifest.status = 'NEEDS_SQL_CLEANUP'; try { save(); } catch { /* preserve original error */ } }
  console.error(`FAIL P3 PDF live: ${error instanceof Error ? error.message : 'UNKNOWN'}`);
  console.error(`Fixture manifest: ${manifestPath}; exact-ID SQL: ${sqlPath}`);
  process.exitCode = 1;
}
