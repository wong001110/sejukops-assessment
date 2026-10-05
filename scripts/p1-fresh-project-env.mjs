import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { parseEnv } from 'node:util';

/** Fresh-project credentials must live under the repository's ignored temp path. */
export function loadFreshProjectEnv(root, file) {
  if (!file || typeof file !== 'string') throw new Error('Fresh project requires --credentials-file');
  const temp = resolve(root, 'supabase/.temp');
  const path = resolve(root, file);
  const inside = relative(temp, path);
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`)
    || isAbsolute(inside)) {
    throw new Error('Fresh project credentials must be stored under ignored supabase/.temp');
  }
  return parseEnv(readFileSync(path, 'utf8'));
}
