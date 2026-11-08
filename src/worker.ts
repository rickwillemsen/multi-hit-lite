/// <reference lib="webworker" />
import { checkPair, Issue, parseMatrixCsv } from './core/csv';
import type { Data } from './core/data';
import { parseExclusionList } from './core/exclusionList';
import { checkParams } from './core/params';
import { excludedRows, runGreedyPipeline, sampleRows, VIZ_LIMITS } from './core/pipeline';
import type { DataPreview, ExclusionSummary, FromWorker, Source, ToWorker } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let normal: Data | null = null;
let tumor: Data | null = null;
let instanceName = 'instance';
let exclusion: { name: string; ids: Set<string> } | null = null;

const post = (m: FromWorker) => self.postMessage(m);

async function readSource(s: Source): Promise<{ text: string; name: string }> {
  if (s.kind === 'text') return { text: s.text, name: s.name };
  return { text: await s.file.text(), name: s.file.name };
}

function exclusionSummary(): ExclusionSummary | null {
  if (!exclusion) return null;
  return { name: exclusion.name, idsInList: exclusion.ids.size, matchedInData: tumor ? excludedRows(tumor.geneIds, exclusion.ids).length : null };
}

function preview(): DataPreview | null {
  if (!normal || !tumor || tumor.numGenes > VIZ_LIMITS.genes || Math.max(tumor.numSamples, normal.numSamples) > VIZ_LIMITS.samplesPerClass) return null;
  return { geneIds: tumor.geneIds, tumor: sampleRows(tumor), normal: sampleRows(normal), excluded: exclusion ? excludedRows(tumor.geneIds, exclusion.ids) : [] };
}

function exclusionIssues(): Issue[] {
  const s = exclusionSummary();
  if (s && s.matchedInData === 0) {
    return [{ level: 'warning', file: s.name, message: 'None of the gene IDs on the exclusion list occur in the data, so no genes are excluded. The IDs must be written exactly as in the data files.' }];
  }
  return [];
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    if (msg.type === 'exclusion') {
      if (!msg.source) {
        exclusion = null;
        post({ type: 'exclusion', ok: true, issues: [], summary: null });
        post({ type: 'preview', preview: preview() });
        return;
      }
      const { text, name } = await readSource(msg.source);
      const list = parseExclusionList(text, name);
      const ok = !list.issues.some((i) => i.level === 'error');
      exclusion = ok ? { name, ids: list.ids } : null;
      post({ type: 'exclusion', ok, issues: [...list.issues, ...(ok ? exclusionIssues() : [])], summary: ok ? exclusionSummary() : null });
      post({ type: 'preview', preview: preview() });
    } else if (msg.type === 'load') {
      normal = tumor = null;
      post({ type: 'preview', preview: null });
      const [n, t] = await Promise.all([readSource(msg.normal), readSource(msg.tumor)]);
      const pn = parseMatrixCsv(n.text, n.name);
      const pt = parseMatrixCsv(t.text, t.name);
      const issues: Issue[] = [...pn.issues, ...pt.issues];
      if (pn.data && pt.data) issues.push(...checkPair(pn.data, pt.data, msg.testShare));
      if (!pn.data || !pt.data || issues.some((i) => i.level === 'error')) {
        post({ type: 'loaded', ok: false, issues });
        return;
      }
      let neverMutated = 0;
      for (let g = 0; g < pt.data.numGenes; g++) if (pt.data.rowCount(g) === 0) neverMutated++;
      if (neverMutated === pt.data.numGenes) {
        issues.push({ level: 'error', file: t.name, message: 'No gene is mutated in any tumor sample.' });
        post({ type: 'loaded', ok: false, issues });
        return;
      }
      normal = pn.data;
      tumor = pt.data;
      instanceName = t.name.replace(/-tumor\.csv$|\.csv$/i, '');
      post({ type: 'loaded', ok: true, issues, summary: { numGenes: tumor.numGenes, normalSamples: normal.numSamples, tumorSamples: tumor.numSamples } });
      if (exclusion) post({ type: 'exclusion', ok: true, issues: exclusionIssues(), summary: exclusionSummary() });
      post({ type: 'preview', preview: preview() });
    } else if (msg.type === 'run') {
      if (!normal || !tumor) throw new Error('Load data first.');
      const errors = checkParams(msg.params);
      const pairIssues = checkPair(normal, tumor, msg.params.testShare).filter((i) => i.level === 'error');
      if (errors.length || pairIssues.length) throw new Error([...errors, ...pairIssues.map((i) => i.message)].join(' '));
      let last = 0;
      const result = runGreedyPipeline(normal, tumor, exclusion?.ids ?? null, msg.params, instanceName, (progress) => {
        const now = performance.now();
        if (progress.phase === 'greedy' || now - last > 100) {
          last = now;
          post({ type: 'progress', progress });
        }
      }, msg.trace);
      post({ type: 'result', result });
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
