import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Writes dist/sw.js: a service worker that stores every file of the site on the first visit,
 * so the page keeps working without internet. The cache name changes with the content, so a
 * new deploy replaces the old copy.
 */
function offlineServiceWorker(): Plugin {
  return {
    name: 'offline-service-worker',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = new Set<string>(Object.keys(bundle));
      const walk = (dir: string) => {
        for (const f of readdirSync(dir)) {
          const p = join(dir, f);
          if (statSync(p).isDirectory()) walk(p);
          else files.add(relative('public', p).replaceAll('\\', '/'));
        }
      };
      walk('public');
      const list = ['./', 'index.html', ...[...files].filter((f) => f !== 'sw.js').sort()];
      const hash = createHash('sha256');
      for (const f of [...files].sort()) {
        const item = bundle[f];
        if (item) hash.update(item.type === 'chunk' ? item.code : typeof item.source === 'string' ? item.source : Buffer.from(item.source));
        else hash.update(readFileSync(join('public', f)));
      }
      const version = hash.digest('hex').slice(0, 12);
      const source = readFileSync('src/sw-template.js', 'utf8')
        .replace('__VERSION__', version)
        .replace('__FILES__', JSON.stringify(list, null, 1));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  plugins: [offlineServiceWorker()],
  test: { include: ['tests/**/*.test.ts'] },
});
