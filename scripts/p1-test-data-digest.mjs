// Stable digest of all application rows plus the four managed Auth identities.
// Only the digest is returned; raw rows and credential hashes stay in PostgreSQL.
export function testDataDigestSql(baseline) {
  const tables = [...baseline.matchAll(/^CREATE TABLE (public|private)\.([a-z_][a-z_0-9]*)\s*\(/gm)]
    .map(([, schema, table]) => `${schema}.${table}`);
  if (tables.length !== 24 || new Set(tables).size !== 24) {
    throw new Error('Reviewed Test application table set changed');
  }
  const parts = tables.map(name =>
    `select '${name}' as source, md5(to_jsonb(t)::text) as row_hash from ${name} t`);
  parts.push(`select 'auth.users' as source,
    md5(to_jsonb(row(u.id,lower(u.email),u.encrypted_password,
      u.email_confirmed_at,u.is_anonymous))::text) as row_hash from auth.users u`);
  return `with row_hashes as (${parts.join('\nunion all\n')})
select md5(coalesce(string_agg(source || ':' || row_hash, E'\\n'
  order by source,row_hash),'')) from row_hashes;`;
}

export function testAuthDigestSql() {
  return `select md5(coalesce(string_agg(
    md5(to_jsonb(row(u.id,lower(u.email),u.encrypted_password,
      u.email_confirmed_at,u.is_anonymous))::text), E'\\n' order by u.id),''))
    from auth.users u;`;
}
