// Convert a reviewed pg_dump --schema-only of public,private into SQL that a
// fresh Supabase migration runner can execute. Does not connect to a database.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function replaceOnce(input, pattern, replacement, label) {
  const matches = [...input.matchAll(new RegExp(pattern.source, pattern.flags.includes('g')
    ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== 1) throw new Error(`Unexpected schema dump shape: ${label}`);
  return input.replace(pattern, replacement);
}

export function normalizeFreshBaseline(raw) {
  if (typeof raw !== 'string' || raw.includes('qobhjvrrpajoyvlgrkbx')) {
    throw new Error('Invalid or project-specific schema dump');
  }
  // pg_dump output captured through a Windows child process can contain
  // doubled carriage returns in function bodies. Canonicalize both forms.
  let sql = raw.replace(/\r+\n/g, '\n');
  sql = replaceOnce(sql, /^\\restrict [^\n]*\n/m, '', 'psql restrict');
  sql = replaceOnce(sql, /^\\unrestrict [^\n]*\n/m, '', 'psql unrestrict');
  sql = replaceOnce(sql, /^SET transaction_timeout = 0;\n/m, '', 'PG17 transaction timeout');
  sql = replaceOnce(sql, /^CREATE SCHEMA public;\n/m,
    '-- The Supabase target already supplies the public schema.\n', 'public schema');

  const defaultAclStart = sql.indexOf('-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL;');
  const dumpEnd = sql.indexOf('-- PostgreSQL database dump complete');
  if (defaultAclStart < 0 || dumpEnd < defaultAclStart ||
      sql.indexOf('-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL;', defaultAclStart + 1) < 0) {
    // There are two sequences sections (postgres and supabase_admin) in the
    // reviewed Test dump. Any changed shape needs a fresh manual review.
    throw new Error('Unexpected schema dump shape: default privileges');
  }
  const blockStart = sql.lastIndexOf('--\n', defaultAclStart);
  if (blockStart < 0) throw new Error('Unexpected schema dump shape: default ACL header');
  const futureAcl = `-- Future postgres-owned application objects stay server-side by default.
-- New migrations must still explicitly review their grants and RLS.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;
`;
  sql = `${sql.slice(0, blockStart)}${futureAcl}\n${sql.slice(dumpEnd)}`;

  const aclMarker = '-- Name: SCHEMA private; Type: ACL;';
  if (sql.indexOf(aclMarker) < 0 || sql.indexOf(aclMarker) !== sql.lastIndexOf(aclMarker)) {
    throw new Error('Unexpected schema dump shape: ACL boundary');
  }
  const existingAcl = `-- Remove any Data API grants inherited from a new project's defaults
-- before replaying the reviewed explicit grants below.
REVOKE ALL ON ALL TABLES IN SCHEMA public, private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public, private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public, private FROM PUBLIC, anon, authenticated;

`;
  sql = sql.replace(aclMarker, `${existingAcl}${aclMarker}`);
  if (/^\\|^CREATE SCHEMA public;|ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin/m.test(sql)) {
    throw new Error('Unsafe migration command survived normalization');
  }
  return `${sql.trimEnd()}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || process.argv.length !== 4) {
    console.error('Usage: node scripts/p1-normalize-fresh-baseline.mjs INPUT OUTPUT');
    process.exitCode = 2;
  } else {
    try {
      await writeFile(output, normalizeFreshBaseline(await readFile(input, 'utf8')));
      console.log(`Normalized fresh baseline: ${output}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Baseline normalization failed');
      process.exitCode = 2;
    }
  }
}
