import { Data } from './data';

export interface Issue {
  level: 'error' | 'warning';
  file: string;
  line?: number;
  message: string;
}

export interface ParseResult {
  data: Data | null;
  issues: Issue[];
}

const MAX_ISSUES_PER_FILE = 25;

/**
 * Reads and validates one matrix file:
 *   line 1:  numGenes,numSamples
 *   line 2+: rowIndex,geneId,v1,...,vN   (each v is 0 or 1)
 * Anything malformed is reported with its line number.
 */
export function parseMatrixCsv(text: string, file: string): ParseResult {
  const issues: Issue[] = [];
  let errorCount = 0;
  let suppressed = 0;
  const error = (message: string, line?: number) => {
    errorCount++;
    if (errorCount > MAX_ISSUES_PER_FILE) {
      suppressed++;
      return;
    }
    issues.push({ level: 'error', file, line, message });
  };

  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // byte order mark

  let pos = 0;
  const len = text.length;
  const nextLine = (): string | null => {
    if (pos >= len) return null;
    let end = text.indexOf('\n', pos);
    if (end < 0) end = len;
    let line = text.slice(pos, end);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    pos = end + 1;
    return line;
  };

  const header = nextLine();
  if (header === null || header.trim() === '') {
    error('The file is empty.');
    return { data: null, issues };
  }
  const h = header.split(',');
  const numGenes = Number(h[0]);
  const numSamples = Number(h[1]);
  if (h.length !== 2 || !/^\d+$/.test(h[0].trim()) || !/^\d+$/.test((h[1] ?? '').trim()) || numGenes < 1 || numSamples < 1) {
    error(`The first line must be "numberOfGenes,numberOfSamples" with two positive whole numbers, but it is "${header.slice(0, 60)}".`, 1);
    return { data: null, issues };
  }
  const geneIds: string[] = [];
  const data = new Data(file, numGenes, numSamples, geneIds);
  const seenIds = new Map<string, number>();
  let row = 0;
  let lineNo = 1;
  let line: string | null;
  while ((line = nextLine()) !== null) {
    lineNo++;
    if (line === '') {
      // allow empty lines only at the very end
      const rest = text.slice(pos);
      if (rest.trim() === '') break;
      error('Empty line in the middle of the file.', lineNo);
      continue;
    }
    if (row >= numGenes) {
      error(`More gene rows than the ${numGenes} announced on the first line.`, lineNo);
      break;
    }
    const c1 = line.indexOf(',');
    const c2 = c1 < 0 ? -1 : line.indexOf(',', c1 + 1);
    if (c1 < 0 || c2 < 0) {
      error('A row needs a row number, a gene ID and the 0/1 values, separated by commas.', lineNo);
      geneIds.push('');
      row++;
      continue;
    }
    const idx = line.slice(0, c1).trim();
    if (idx !== String(row)) error(`Row number should be ${row}, found "${idx.slice(0, 20)}".`, lineNo);
    const id = line.slice(c1 + 1, c2).trim();
    if (id === '') error('Gene ID is empty.', lineNo);
    else if (seenIds.has(id)) error(`Gene ID "${id}" also appears on line ${seenIds.get(id)}.`, lineNo);
    else seenIds.set(id, lineNo);
    geneIds.push(id);

    // values: exactly numSamples fields of "0" or "1"
    let s = 0;
    let p = c2 + 1;
    let bad = false;
    const L = line.length;
    for (;;) {
      let e = line.indexOf(',', p);
      if (e < 0) e = L;
      const ch = line.charCodeAt(p);
      if (e === p + 1 && (ch === 48 || ch === 49)) {
        if (ch === 49 && s < numSamples) data.set(row, s);
      } else if (!bad) {
        bad = true;
        error(`Value ${s + 1} is "${line.slice(p, e).slice(0, 20)}"; only 0 and 1 are allowed.`, lineNo);
      }
      s++;
      if (e >= L) break;
      p = e + 1;
    }
    if (s !== numSamples) {
      error(`Expected ${numSamples} values (from the first line), found ${s}.`, lineNo);
    }
    row++;
  }
  if (row < numGenes) error(`The first line announces ${numGenes} genes, but the file has ${row} gene rows.`);
  if (suppressed > 0) issues.push({ level: 'error', file, message: `…and ${suppressed} more errors.` });
  return { data: errorCount === 0 ? data : null, issues };
}

/** Checks that need both files: same genes in the same order, and enough samples. */
export function checkPair(normal: Data, tumor: Data, testShare: number): Issue[] {
  const issues: Issue[] = [];
  const both = 'normal + tumor';
  if (normal.numGenes !== tumor.numGenes) {
    issues.push({ level: 'error', file: both, message: `The normal file has ${normal.numGenes} genes and the tumor file ${tumor.numGenes}. Both must list the same genes in the same order.` });
  } else {
    let shown = 0;
    let diff = 0;
    for (let g = 0; g < normal.numGenes; g++) {
      if (normal.geneIds[g] !== tumor.geneIds[g]) {
        diff++;
        if (shown < 5) {
          shown++;
          issues.push({ level: 'error', file: both, line: g + 2, message: `Gene row ${g}: normal has "${normal.geneIds[g]}", tumor has "${tumor.geneIds[g]}". Both files must list the same genes in the same order.` });
        }
      }
    }
    if (diff > shown) issues.push({ level: 'error', file: both, message: `…and ${diff - shown} more rows where the gene IDs differ.` });
  }
  for (const d of [normal, tumor]) {
    const numTest = Math.floor(d.numSamples * testShare + 0.5);
    if (d.numSamples - numTest < 1) issues.push({ level: 'error', file: d.name, message: `With ${d.numSamples} samples and a test share of ${testShare}, no samples are left for training.` });
    else if (numTest < 1 && testShare > 0) issues.push({ level: 'warning', file: d.name, message: `With ${d.numSamples} samples the test set is empty, so test scores will be 0.` });
  }
  return issues;
}
