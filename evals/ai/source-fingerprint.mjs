import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export function sourceFingerprint(root=process.cwd()) {
  const walk=dir=>fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${dir}/${e.name}`):/\.(ts|tsx)$/.test(e.name)?[`${dir}/${e.name}`]:[]);
  const files=[...walk('src'),'package.json','pnpm-lock.yaml'].sort();
  const hash=crypto.createHash('sha256');
  for(const file of files)hash.update(file+'\0').update(fs.readFileSync(path.join(root,file))).update('\0');
  return hash.digest('hex');
}
