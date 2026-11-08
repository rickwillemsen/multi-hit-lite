import { describe, expect, it } from 'vitest';
import { checkPair, parseMatrixCsv } from '../src/core/csv';
import { parseExclusionList } from '../src/core/exclusionList';

const ok = '3,4\n0,G1,1,0,0,1\n1,G2,0,0,0,0\n2,G3,1,1,1,1\n';

describe('parseMatrixCsv', () => {
  it('reads a valid file (LF and CRLF)', () => {
    for (const text of [ok, ok.replace(/\n/g, '\r\n'), ok.trimEnd()]) {
      const r = parseMatrixCsv(text, 'f');
      expect(r.issues).toEqual([]);
      expect(r.data!.geneIds).toEqual(['G1', 'G2', 'G3']);
      expect(r.data!.get(0, 0)).toBe(true);
      expect(r.data!.get(0, 1)).toBe(false);
      expect(r.data!.rowCount(2)).toBe(4);
    }
  });

  const bad: [string, string, RegExp][] = [
    ['empty', '', /empty/],
    ['bad header', 'genes,samples\n', /first line/],
    ['wrong value', '1,3\n0,G1,1,2,0\n', /only 0 and 1/],
    ['too few values', '1,3\n0,G1,1,0\n', /Expected 3 values/],
    ['too many values', '1,3\n0,G1,1,0,1,1\n', /Expected 3 values/],
    ['missing rows', '3,2\n0,G1,1,0\n', /2 announced|has 1 gene rows/],
    ['extra rows', '1,2\n0,G1,1,0\n1,G2,1,1\n', /More gene rows/],
    ['duplicate id', '2,2\n0,G1,1,0\n1,G1,1,1\n', /also appears/],
    ['row number', '2,2\n0,G1,1,0\n5,G2,1,1\n', /Row number should be 1/],
    ['empty id', '1,2\n0,,1,0\n', /Gene ID is empty/],
    ['trailing comma', '1,2\n0,G1,1,0,\n', /Expected 2 values|only 0 and 1/],
    ['blank line inside', '2,2\n0,G1,1,0\n\n1,G2,1,1\n', /Empty line/],
  ];
  for (const [label, text, re] of bad) {
    it(`rejects: ${label}`, () => {
      const r = parseMatrixCsv(text, 'f');
      expect(r.data).toBeNull();
      expect(r.issues.map((i) => i.message).join(' | ')).toMatch(re);
    });
  }
});

describe('checkPair', () => {
  it('requires the same genes in the same order', () => {
    const a = parseMatrixCsv(ok, 'normal').data!;
    const b = parseMatrixCsv('3,4\n0,G1,1,0,0,1\n1,G3,0,0,0,0\n2,G2,1,1,1,1\n', 'tumor').data!;
    const issues = checkPair(a, b, 0.25);
    expect(issues.some((i) => i.level === 'error' && /Gene row 1/.test(i.message))).toBe(true);
    expect(checkPair(a, a, 0.25)).toEqual([]);
  });
});

describe('parseExclusionList', () => {
  it('reads one ID per line, first column, skips comments and blanks', () => {
    const r = parseExclusionList('\ufeff# my list\nENSG1\r\n\n"ENSG2";TTN;protein_coding\nENSG3,x\n\tENSG4\t\nENSG1\n', 'ex.txt');
    expect([...r.ids]).toEqual(['ENSG1', 'ENSG2', 'ENSG3', 'ENSG4']);
    expect(r.issues.map((i) => i.level)).toEqual(['warning']);
  });
  it('rejects an empty list', () => {
    expect(parseExclusionList('# nothing\n\n', 'ex.txt').issues[0].level).toBe('error');
  });
});
