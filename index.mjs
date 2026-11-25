import { isDeepStrictEqual } from 'node:util';
import { parse } from 'yaml';
import { check, error, projectFile, readProjectFile, service, text, verdict, z } from '@cairul/plugin-kit';

function matchesDocument(parseDocument) {
  return check(
    z.strictObject({
      path: text,
      fields: z.array(z.union([text, z.number().int().nonnegative()])).min(1),
      equals: z.json(),
    }),
    async ({ path, fields, equals }, { projectDir, signal }) => {
      try {
        let value = parseDocument(await readProjectFile(projectDir, path, signal));
        for (const field of fields) {
          if (value == null || !Object.hasOwn(value, field)) return verdict(false, 'Document field does not exist.');
          value = value[field];
        }
        return verdict(isDeepStrictEqual(value, equals), 'Document field evaluated.');
      } catch (cause) {
        return cause?.code === 'ENOENT'
          ? verdict(false, 'Waiting for document.')
          : error('document is unreadable or invalid.');
      }
    }
  );
}

export default function workspace() {
  return {
    checkKinds: {
      'file.exists': check(z.strictObject({ path: text }), async ({ path }, { projectDir }) => {
        try {
          await projectFile(projectDir, path);
          return verdict(true, 'Path exists.');
        } catch (cause) {
          return cause?.code === 'ENOENT'
            ? verdict(false, 'Waiting for path.')
            : error('Path is inaccessible or leaves the project.');
        }
      }),
      'json.matches': matchesDocument(JSON.parse),
      'yaml.matches': matchesDocument((source) => parse(source, { maxAliasCount: 0 })),
      'http.status': check(
        z.strictObject({
          url: z.url({ protocol: /^https?$/ }),
          status: z.number().int().min(100).max(599).default(200),
        }),
        ({ url, status }, { signal }) =>
          service(async () => {
            const response = await globalThis.fetch(url, { signal, redirect: 'manual' });
            await response.body?.cancel();
            return verdict(response.status === status, `HTTP status ${response.status}; expected ${status}.`);
          })
      ),
    },
  };
}
