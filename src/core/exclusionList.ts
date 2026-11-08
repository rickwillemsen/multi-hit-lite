import type { Issue } from './csv';

export interface ExclusionList {
  ids: Set<string>;
  issues: Issue[];
}

/**
 * Reads a user-supplied list of gene IDs to exclude.
 * One gene ID per line. If a line has several columns (comma, semicolon or tab), the first column is used.
 * Empty lines and lines starting with # are skipped; quotes around an ID are removed.
 */
export function parseExclusionList(text: string, file: string): ExclusionList {
  const ids = new Set<string>();
  const issues: Issue[] = [];
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/);
  let duplicates = 0;
  lines.forEach((raw) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const id = line.split(/[,;\t]/)[0].trim().replace(/^"(.*)"$/, '$1').trim();
    if (id === '') return;
    if (ids.has(id)) duplicates++;
    ids.add(id);
  });
  if (ids.size === 0) issues.push({ level: 'error', file, message: 'The exclusion list contains no gene IDs.' });
  if (duplicates > 0) issues.push({ level: 'warning', file, message: `${duplicates} gene IDs appear more than once; each is excluded once.` });
  return { ids, issues };
}
