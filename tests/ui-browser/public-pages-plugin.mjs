// Reuse original page markup. Only server-only identity/actions are replaced for
// this local renderer; Next/product builds never load this plugin.
export function publicPagesPlugin() {
  const pages = new Set(['src/app/page.tsx', 'src/app/login/page.tsx', 'src/app/owner/login/page.tsx', 'src/app/demo/page.tsx', 'src/app/owner/page.tsx', 'src/app/owner/password/page.tsx', 'src/app/account/password/page.tsx', 'src/app/platform/ai-settings/page.tsx', 'src/app/platform/staff/page.tsx', 'src/app/platform/demo/page.tsx', 'src/app/diagnostics/ai-observability/page.tsx']);
  return { name: 'mock-server-page-boundaries', enforce: 'pre', transform(source, id) {
    const path = id.split('?')[0].replaceAll('\\', '/');
    const relative = path.slice(path.indexOf('/src/app/') + 1);
    if (pages.has(relative)) {
      const imports = [...source.matchAll(/import[\s\S]*?from\s+["'][^"']+["'];/g)].map(m => m[0]).filter(line => /from ["'](?:antd|@ant-design\/icons|next\/link|\.\/password-form|@\/components\/)/.test(line)).join('\n');
      const start = source.indexOf('  return ');
      if (start < 0) throw new Error(`Mock page cannot locate markup: ${relative}`);
      const body = source.slice(start).replace(/action=\{(?:signInStaff|signInOwner|signOutStaff|signOutOwner)\}/g, 'onSubmit={(event) => event.preventDefault()}').replace('action="/api/demo/entry" method="post"', 'onSubmit={(event) => event.preventDefault()}');
      return `${imports}\nimport { malaysiaTimeZoneLabel } from '@/lib/time/malaysia';\nexport default function MockServerPage({ searchParams = {} }: {searchParams?: {error?:string;notice?:string}}) {\nconst params=new URLSearchParams(window.location.search); const error=params.get("error"),notice=params.get("notice"); const canViewPlatform=true; const hasSupabaseConfig=true; const authData={user:null}; const workspaceId='10000000-0000-4000-8000-000000000001'; const actor={staff:{passwordChangeRequired:true}};\n${body}`;
    }
    if (/src\/app\/(owner|account)\/password\/password-form\.tsx$/.test(relative)) {
      let code = source.replace('from "./actions"', 'from "../../../tests/ui-browser/auth-actions"');
      // Absolute adapter path is required because the two forms have different depth.
      code = code.replace('"../../../tests/ui-browser/auth-actions"', JSON.stringify(path.slice(0,path.indexOf('/src/app/')) + '/tests/ui-browser/auth-actions.ts'));
      code = code.replace('import { useActionState } from "react";', `import { useMockActionState as useActionState } from ${JSON.stringify(path.slice(0,path.indexOf('/src/app/')) + '/tests/ui-browser/auth-actions.ts')};`);
      code = code.replace('<form action={submit}', '<form onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }}');
      return code;
    }
  } };
}
