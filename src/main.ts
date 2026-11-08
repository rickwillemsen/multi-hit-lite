import './style.css';
import type { Issue } from './core/csv';
import { checkParams, DEFAULT_PARAMS, Params } from './core/params';
import type { RunResult } from './core/pipeline';
import { checkSyntheticParams, DEFAULT_SYNTHETIC, generateSynthetic, PlantedPattern, SyntheticParams } from './core/synthetic';
import type { Metrics } from './core/metrics';
import type { DataPreview, DataSummary, ExclusionSummary, FromWorker, Source, ToWorker } from './protocol';
import { combinationsCsv, metricsCsv } from './resultsCsv';
import { MethodPlayer, renderDataView, renderSolution } from './viz';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ---------- form fields ----------
type Field<T> = { key: keyof T & string; label: string; help?: string; kind?: 'int' | 'num' };
type Pair<T> = { label: string; help?: string; tumor: Field<T>; normal: Field<T> };
type Group<T> = { title: string; fields?: Field<T>[]; pairs?: Pair<T>[] };

const SYN_GROUPS: Group<SyntheticParams>[] = [
  {
    title: 'Dataset',
    fields: [
      { key: 'numGenes', label: 'Genes', kind: 'int' },
      { key: 'seed', label: 'Random seed', help: 'The same seed gives the same dataset', kind: 'int' },
    ],
  },
  {
    title: 'Tumor and normal samples',
    pairs: [
      { label: 'Samples', tumor: { key: 'numTumor', label: 'Tumor samples', kind: 'int' }, normal: { key: 'numNormal', label: 'Normal samples', kind: 'int' } },
      {
        label: 'Background mutation rate',
        help: 'Average chance that a gene is mutated in a sample',
        tumor: { key: 'tumorRate', label: 'Background mutation rate, tumor' },
        normal: { key: 'normalRate', label: 'Background mutation rate, normal' },
      },
      {
        label: 'Share of samples with each planted gene combination',
        tumor: { key: 'tumorPrevalence', label: 'Share of tumor samples with each planted gene combination' },
        normal: { key: 'normalPrevalence', label: 'Share of normal samples with each planted gene combination' },
      },
    ],
  },
  {
    title: 'Planted gene combinations',
    fields: [
      { key: 'patternMinSize', label: 'Smallest size', help: 'Genes per gene combination', kind: 'int' },
      { key: 'patternMaxSize', label: 'Largest size', help: 'Genes per gene combination', kind: 'int' },
      { key: 'numPatterns', label: 'Number', help: 'Gene combinations to plant', kind: 'int' },
    ],
  },
];

const PARAM_GROUPS: Group<Params>[] = [
  {
    title: 'Gene combinations',
    fields: [
      { key: 'minHitSize', label: 'Smallest size', help: 'Genes per gene combination', kind: 'int' },
      { key: 'maxHitSize', label: 'Largest size', help: 'Genes per gene combination', kind: 'int' },
      { key: 'beta', label: 'Maximum number in the result', help: 'The search stops earlier when adding a gene combination no longer helps', kind: 'int' },
    ],
  },
  {
    title: 'Candidate search',
    fields: [
      { key: 'maxSelect', label: 'Genes to choose from', help: 'The most frequently mutated genes in the tumor samples', kind: 'int' },
      { key: 'numCombinations', label: 'Random gene combinations to try', help: 'More gives better results but takes longer', kind: 'int' },
    ],
  },
  {
    title: 'Train/test split',
    fields: [
      { key: 'testShare', label: 'Share of samples used for testing', help: 'Tumor and normal samples are split separately' },
      { key: 'seed', label: 'Random seed', help: 'The same seed gives the same split and result', kind: 'int' },
    ],
  },
];

const allFields = <T,>(groups: Group<T>[]): Field<T>[] => groups.flatMap((g) => [...(g.fields ?? []), ...(g.pairs ?? []).flatMap((p) => [p.tumor, p.normal])]);
const SYN_FIELDS = allFields(SYN_GROUPS);
const PARAM_FIELDS = allFields(PARAM_GROUPS);

function inputHtml<T>(f: Field<T>, values: T, prefix: string, ariaLabel?: string): string {
  const v = values[f.key as keyof T];
  return `<input id="${prefix}-${f.key}" type="text" inputmode="${f.kind === 'int' ? 'numeric' : 'decimal'}" autocomplete="off" value="${esc(v)}"${
    ariaLabel ? ` aria-label="${esc(ariaLabel)}"` : ''
  } />`;
}

function renderForm<T extends object>(form: HTMLFormElement, groups: Group<T>[], values: T, prefix: string) {
  const fieldHtml = (f: Field<T>) =>
    `<label class="field" for="${prefix}-${f.key}"><span>${esc(f.label)}${f.help ? ` <small>${esc(f.help)}</small>` : ''}</span>${inputHtml(f, values, prefix)}</label>`;
  const pairsHtml = (pairs: Pair<T>[]) => `<table class="pairs">
      <thead><tr><th></th><th scope="col">Tumor</th><th scope="col">Normal</th></tr></thead>
      <tbody>${pairs
        .map(
          (p) =>
            `<tr><th scope="row">${esc(p.label)}${p.help ? ` <small>${esc(p.help)}</small>` : ''}</th><td>${inputHtml(p.tumor, values, prefix, p.tumor.label)}</td><td>${inputHtml(
              p.normal,
              values,
              prefix,
              p.normal.label,
            )}</td></tr>`,
        )
        .join('')}</tbody></table>`;
  form.innerHTML = groups
    .map(
      (g) =>
        `<fieldset class="group"><legend>${esc(g.title)}</legend>${g.fields ? `<div class="grid">${g.fields.map(fieldHtml).join('')}</div>` : ''}${g.pairs ? pairsHtml(g.pairs) : ''}</fieldset>`,
    )
    .join('');
}

function readForm<T extends object>(fields: Field<T>[], prefix: string, base: T): T {
  const out = { ...base } as Record<string, unknown>;
  for (const f of fields) {
    const el = $<HTMLInputElement>(`${prefix}-${f.key}`);
    out[f.key] = el.value.trim() === '' ? NaN : Number(el.value.trim().replace(',', '.'));
  }
  return out as T;
}

// ---------- step-by-step visualization ----------
/** A small example that is readable step by step. */
const SMALL_SYNTHETIC: SyntheticParams = {
  ...DEFAULT_SYNTHETIC,
  seed: 42,
  numGenes: 8,
  numTumor: 7,
  numNormal: 4,
  tumorRate: 0.2,
  normalRate: 0.1,
  numPatterns: 1,
  patternMinSize: 2,
  patternMaxSize: 3,
  tumorPrevalence: 0.45,
  normalPrevalence: 0.05,
};
const SMALL_PARAMS: Params = { ...DEFAULT_PARAMS, seed: 42, minHitSize: 2, maxHitSize: 3, beta: 4, maxSelect: 6, numCombinations: 6, testShare: 0.25 };
const TOO_LARGE =
  'This dataset is too large to show step by step (at most 40 genes and 60 samples per class). The heuristic still runs normally; use a smaller dataset to see the visualization.';

let vizOn = false;
let preview: DataPreview | null = null;
const synDefaults = () => (vizOn ? SMALL_SYNTHETIC : DEFAULT_SYNTHETIC);
const paramDefaults = () => (vizOn ? SMALL_PARAMS : DEFAULT_PARAMS);

function drawDataView() {
  const el = $('viz-data');
  el.hidden = !vizOn || !summary;
  if (!el.hidden) renderDataView(el, preview, TOO_LARGE);
}

function clearRunViz() {
  player.clear();
  $('viz-solution').hidden = true;
  $('viz-solution').innerHTML = '';
  $('viz-method-note').hidden = true;
}

// ---------- worker ----------
let worker: Worker;
let busy: 'load' | 'run' | null = null;
let sources: { normal: Source; tumor: Source; label: string } | null = null;
let planted: PlantedPattern[] | null = null;
let summary: DataSummary | null = null;
let lastResult: RunResult | null = null;
let runParams: Params | null = null;
let timing: { phase: string; start: number } = { phase: '', start: 0 };
let exclusionSource: Source | null = null;
let exclusionInfo: ExclusionSummary | null = null;

function startWorker() {
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<FromWorker>) => onWorker(e.data);
  worker.onerror = (e) => {
    busy = null;
    setStatus(`Something went wrong: ${e.message}`, 'error');
    updateButtons();
  };
}
const send = (m: ToWorker) => worker.postMessage(m);

function onWorker(m: FromWorker) {
  if (m.type === 'loaded') {
    busy = null;
    summary = m.ok ? m.summary! : null;
    renderValidation(m.ok, m.issues, m.summary);
    drawDataView();
  } else if (m.type === 'preview') {
    preview = m.preview;
    drawDataView();
  } else if (m.type === 'exclusion') {
    exclusionInfo = m.summary;
    renderExclusion(m.ok, m.issues, m.summary);
    setStatus(m.ok ? 'Ready to run.' : 'Fix the data problems above first.', m.ok ? 'ok' : 'error');
  } else if (m.type === 'progress') {
    const p = m.progress;
    const now = performance.now();
    if (p.phase !== timing.phase) timing = { phase: p.phase, start: now };
    const elapsed = (now - timing.start) / 1000;
    if (p.phase === 'candidates') {
      const total = runParams?.numCombinations ?? 0;
      const left = p.found > 0 && elapsed > 1 ? ((total - p.found) * elapsed) / p.found : NaN;
      setStatus(
        `Generating candidate gene combinations: ${p.found.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} found (${p.iterations.toLocaleString('en-US')} tries)${timeLeft(left)}…`,
      );
    } else {
      const total = runParams?.beta ?? 0;
      const left = p.step > 0 ? ((total - p.step) * elapsed) / p.step : NaN;
      setStatus(`Greedy selection: ${p.step} of at most ${total} gene combination${total === 1 ? '' : 's'} chosen${timeLeft(left)}…`);
    }
  } else if (m.type === 'result') {
    busy = null;
    lastResult = m.result;
    renderResults(m.result);
    showRunViz(m.result);
    setStatus(`Done in ${m.result.seconds.toFixed(1)} s.`, 'ok');
  } else if (m.type === 'error') {
    busy = null;
    setStatus(m.message, 'error');
  }
  updateButtons();
}

function loadData(normal: Source, tumor: Source, label: string) {
  sources = { normal, tumor, label };
  summary = null;
  clearRunViz();
  busy = 'load';
  $('validation').innerHTML = `<p class="status">Reading and checking ${esc(label)}…</p>`;
  setStatus('Checking data…');
  updateButtons();
  send({ type: 'load', normal, tumor, testShare: currentParams().testShare || DEFAULT_PARAMS.testShare });
}

// ---------- UI ----------
function setStatus(text: string, kind: 'ok' | 'error' | '' = '') {
  const el = $('run-status');
  el.textContent = text;
  el.className = `status ${kind}`;
}

function updateButtons() {
  $<HTMLButtonElement>('btn-run').disabled = !summary || busy !== null;
  $<HTMLButtonElement>('btn-generate').disabled = busy !== null;
  $('btn-cancel').hidden = busy !== 'run';
}

function currentParams(): Params {
  return readForm(PARAM_FIELDS, 'p', DEFAULT_PARAMS);
}

function issueList(issues: Issue[]) {
  return `<ul class="issues">${issues
    .map((i) => `<li class="${i.level}"><strong>${i.level === 'error' ? 'Error' : 'Warning'}</strong> · ${esc(i.file)}${i.line ? `, line ${i.line}` : ''}: ${esc(i.message)}</li>`)
    .join('')}</ul>`;
}

function renderValidation(ok: boolean, issues: Issue[], s?: DataSummary) {
  const head = ok
    ? `<p class="ok-box">✓ ${esc(sources?.label ?? 'Data')} is valid: ${s!.numGenes.toLocaleString('en-US')} genes, ${s!.tumorSamples} tumor and ${s!.normalSamples} normal samples.</p>`
    : `<p class="error-box">✗ ${esc(sources?.label ?? 'The data')} cannot be used yet. Problems found:</p>`;
  $('validation').innerHTML = head + (issues.length ? issueList(issues) : '');
}

function renderExclusion(ok: boolean, issues: Issue[], s: ExclusionSummary | null) {
  const el = $('exclusion-status');
  $('btn-exclusion-clear').hidden = !s;
  if (!s && ok) {
    el.innerHTML = '<p class="hint">No exclusion list: all genes are used.</p>';
    $('name-exclusion').textContent = 'Choose or drop a file (optional)';
    $('drop-exclusion').classList.remove('has-file');
    return;
  }
  const head = ok
    ? `<p class="ok-box">✓ Exclusion list ${esc(s!.name)}: ${s!.idsInList.toLocaleString('en-US')} gene IDs${
        s!.matchedInData === null ? '.' : `, of which ${s!.matchedInData.toLocaleString('en-US')} occur in the data and will be excluded.`
      }</p>`
    : '<p class="error-box">✗ The exclusion list cannot be used:</p>';
  el.innerHTML = head + (issues.length ? issueList(issues) : '');
}

function fmt(x: number) {
  return Number.isInteger(x) ? String(x) : x.toFixed(4);
}

function metricsRow(label: string, m: Metrics) {
  return `<tr><th scope="row">${esc(label)}</th>${[m.TP, m.TN, m.FP, m.FN, m.MCC, m.specificity, m.sensitivity, m.F1].map((v) => `<td class="numeric">${fmt(v)}</td>`).join('')}</tr>`;
}

/** Rough remaining time, e.g. " (about 15 s left)"; empty while there is no estimate yet. */
function timeLeft(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 1) return ' (less than a second left)';
  if (seconds < 60) return ` (about ${Math.ceil(seconds)} s left)`;
  return ` (about ${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s left)`;
}

/** Planted gene combination that shares the most genes with `ids` (the lowest number on a tie). */
function bestPlanted(ids: string[]): { index: number; shared: number; exact: boolean } {
  let index = -1;
  let shared = 0;
  (planted ?? []).forEach((p, k) => {
    const n = ids.filter((g) => p.geneIds.includes(g)).length;
    if (n > shared) {
      shared = n;
      index = k;
    }
  });
  const exact = index >= 0 && shared === ids.length && shared === planted![index].geneIds.length;
  return { index, shared, exact };
}

function renderResults(r: RunResult) {
  if (r.numCandidates === 0) {
    const now = r.params.maxSelect;
    $('results').innerHTML = `<div class="error-box">
      <p><strong>No candidate gene combinations were found.</strong> None of the ${r.candidateIterations.toLocaleString('en-US')} random gene combinations that were tried covers a tumor sample in the training set, so the search stopped and there was nothing to select.</p>
      <p>Try a lower value for <strong>Settings → Candidate search → Genes to choose from</strong> (now ${now.toLocaleString('en-US')}), for example ${Math.max(1, Math.floor(now / 2)).toLocaleString('en-US')}.</p>
    </div>`;
    $('btn-dl-combos').hidden = true;
    $('btn-dl-metrics').hidden = true;
    $('step-results').hidden = false;
    return;
  }
  $('btn-dl-combos').hidden = false;
  $('btn-dl-metrics').hidden = false;
  const rows = r.steps
    .map((s, i) => {
      const ids = r.combinationIds[i];
      const b = bestPlanted(ids);
      const mark =
        b.index < 0
          ? '<span class="no-match">–</span>'
          : b.exact
            ? `✓ planted #${b.index + 1}`
            : `${b.shared} of the ${planted![b.index].geneIds.length} genes of planted #${b.index + 1}`;
      return `<tr><td class="numeric">${i + 1}</td><td class="genes">${ids.map(esc).join(' + ')}</td><td class="numeric">${fmt(s.objective)}</td><td class="numeric">${s.tumorCovered}</td><td class="numeric">${s.normalCovered}</td>${
        planted ? `<td>${mark}</td>` : ''
      }</tr>`;
    })
    .join('');
  const sameGenes = (a: string[], b: string[]) => a.length === b.length && a.every((g) => b.includes(g));
  const exact = (planted ?? []).filter((p) => r.combinationIds.some((c) => sameGenes(c, p.geneIds))).length;
  const touched = (planted ?? []).filter((p) => r.combinationIds.some((c) => c.some((g) => p.geneIds.includes(g)))).length;

  $('results').innerHTML = `
    <div class="stats">
      <div><span class="k">Gene combinations</span><span class="v">${r.combinations.length}</span></div>
      <div><span class="k">Objective (train)</span><span class="v">${fmt(r.objective)}</span></div>
      <div><span class="k">Test MCC</span><span class="v">${fmt(r.test.MCC)}</span></div>
      <div><span class="k">Test sensitivity / specificity</span><span class="v">${fmt(r.test.sensitivity)} / ${fmt(r.test.specificity)}</span></div>
    </div>
    <p class="hint">Stopped: ${esc(r.stopReason)} ${r.numCandidates.toLocaleString('en-US')} candidate gene combinations were generated from the ${Math.min(r.params.maxSelect, summary?.numGenes ?? Infinity)} most frequently mutated tumor genes${
      r.excludedGenes ? ` (${r.excludedGenes.toLocaleString('en-US')} genes excluded by your exclusion list)` : ''
    }. Training set: ${r.split.tumorTrain} tumor + ${r.split.normalTrain} normal samples; test set: ${r.split.tumorTest} tumor + ${r.split.normalTest} normal samples.${
      planted ? ` Of the ${planted.length} planted gene combinations, ${exact} ${exact === 1 ? 'was' : 'were'} found exactly; the chosen gene combinations contain genes of ${touched}.` : ''
    }</p>
    <h3>Chosen gene combinations, in the order they were added</h3>
    <div class="table-wrap"><table>
      <thead><tr><th class="numeric">#</th><th>Genes</th><th class="numeric">Objective</th><th class="numeric">Tumor samples<br />covered</th><th class="numeric">Normal<br />coverings</th>${planted ? '<th>Synthetic</th>' : ''}</tr></thead>
      <tbody>${rows || `<tr><td colspan="7">No gene combination improved the objective.</td></tr>`}</tbody>
    </table></div>
    <p class="hint">Objective = tumor samples covered − normal coverings, on the training set. A sample is covered when all genes of a gene combination are mutated in it; normal coverings count each gene combination separately.</p>${
      planted ? '<p class="hint">Synthetic: ✓ planted #n = exactly a planted gene combination; k of the m genes of planted #n = the planted gene combination that shares the most genes with this row (ties are not shown); – = no genes of any planted gene combination.</p>' : ''
    }
    <h3>Scores</h3>
    <div class="table-wrap"><table>
      <thead><tr><th></th>${['TP', 'TN', 'FP', 'FN', 'MCC', 'Specificity', 'Sensitivity', 'F1'].map((h) => `<th class="numeric">${h}</th>`).join('')}</tr></thead>
      <tbody>${metricsRow('Training set', r.train)}${metricsRow('Test set', r.test)}</tbody>
    </table></div>`;
  $('step-results').hidden = false;
}

function showRunViz(r: RunResult) {
  clearRunViz();
  if (!vizOn || r.numCandidates === 0) return;
  if (!r.trace) {
    const note = $('viz-method-note');
    note.textContent = `${TOO_LARGE.replace('(at most 40 genes and 60 samples per class)', '(at most 40 genes, 60 samples per class and 60 candidate gene combinations)')}`;
    note.hidden = false;
    return;
  }
  player.load(r.trace, r.params.beta, r.stopReason);
  renderSolution($('viz-solution'), r.trace);
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function selectTab(which: 'generate' | 'upload') {
  for (const t of ['generate', 'upload'] as const) {
    $(`tab-${t}`).setAttribute('aria-selected', String(t === which));
    $(`panel-${t}`).hidden = t !== which;
  }
}

// ---------- wiring ----------
renderForm($<HTMLFormElement>('synthetic-form'), SYN_GROUPS, DEFAULT_SYNTHETIC, 's');
renderForm($<HTMLFormElement>('params-form'), PARAM_GROUPS, DEFAULT_PARAMS, 'p');
const player = new MethodPlayer($('viz-method'));
player.clear();
startWorker();
updateButtons();

$('tab-generate').onclick = () => selectTab('generate');
$('tab-upload').onclick = () => selectTab('upload');

$('btn-generate').onclick = () => {
  const p = readForm(SYN_FIELDS, 's', DEFAULT_SYNTHETIC);
  const errors = checkSyntheticParams(p);
  if (errors.length) {
    $('synthetic-info').innerHTML = `<ul class="issues">${errors.map((e) => `<li class="error">${esc(e)}</li>`).join('')}</ul>`;
    return;
  }
  $('synthetic-info').innerHTML = '<p class="status">Generating…</p>';
  setTimeout(() => {
    const syn = generateSynthetic(p);
    planted = syn.patterns;
    const base = `synthetic_seed${p.seed}`;
    $('synthetic-info').innerHTML = `
      <p class="hint">Planted gene combinations (tumor / normal samples that carry them):</p>
      <ol class="planted">${syn.patterns.map((x) => `<li><code>${x.geneIds.map(esc).join(' + ')}</code> · ${x.tumorSamples} tumor / ${x.normalSamples} normal</li>`).join('')}</ol>
      <div class="actions"><button type="button" id="dl-syn-normal">Download ${base}-normal.csv</button><button type="button" id="dl-syn-tumor">Download ${base}-tumor.csv</button></div>`;
    $('dl-syn-normal').onclick = () => download(`${base}-normal.csv`, syn.normalCsv);
    $('dl-syn-tumor').onclick = () => download(`${base}-tumor.csv`, syn.tumorCsv);
    loadData({ kind: 'text', text: syn.normalCsv, name: `${base}-normal.csv` }, { kind: 'text', text: syn.tumorCsv, name: `${base}-tumor.csv` }, 'The synthetic data');
  }, 20);
};

const files: { normal: File | null; tumor: File | null } = { normal: null, tumor: null };
for (const kind of ['normal', 'tumor'] as const) {
  const input = $<HTMLInputElement>(`file-${kind}`);
  const drop = $(`drop-${kind}`);
  const pick = (f: File | undefined) => {
    if (!f) return;
    files[kind] = f;
    $(`name-${kind}`).textContent = `${f.name} (${(f.size / 1e6).toFixed(1)} MB)`;
    drop.classList.add('has-file');
    if (files.normal && files.tumor) {
      planted = null;
      loadData({ kind: 'file', file: files.normal }, { kind: 'file', file: files.tumor }, `${files.normal.name} + ${files.tumor.name}`);
    } else {
      $('validation').innerHTML = `<p class="hint">Now choose the ${kind === 'normal' ? 'tumor' : 'normal'} file.</p>`;
    }
  };
  input.onchange = () => pick(input.files?.[0]);
  drop.ondragover = (e) => {
    e.preventDefault();
    drop.classList.add('over');
  };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    pick(e.dataTransfer?.files?.[0]);
  };
}

// optional exclusion list
{
  const input = $<HTMLInputElement>('file-exclusion');
  const drop = $('drop-exclusion');
  const pick = (f: File | undefined) => {
    if (!f) return;
    exclusionSource = { kind: 'file', file: f };
    $('name-exclusion').textContent = `${f.name} (${(f.size / 1e3).toFixed(1)} kB)`;
    drop.classList.add('has-file');
    $('exclusion-status').innerHTML = '<p class="status">Reading exclusion list…</p>';
    send({ type: 'exclusion', source: exclusionSource });
  };
  input.onchange = () => pick(input.files?.[0]);
  drop.ondragover = (e) => {
    e.preventDefault();
    drop.classList.add('over');
  };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    pick(e.dataTransfer?.files?.[0]);
  };
  $('btn-exclusion-clear').onclick = () => {
    exclusionSource = null;
    input.value = '';
    send({ type: 'exclusion', source: null });
  };
  renderExclusion(true, [], null);
}

$('btn-defaults').onclick = () => renderForm($<HTMLFormElement>('params-form'), PARAM_GROUPS, paramDefaults(), 'p');
$('btn-syn-defaults').onclick = () => renderForm($<HTMLFormElement>('synthetic-form'), SYN_GROUPS, synDefaults(), 's');

$<HTMLInputElement>('viz-toggle').onchange = (e) => {
  vizOn = (e.target as HTMLInputElement).checked;
  renderForm($<HTMLFormElement>('synthetic-form'), SYN_GROUPS, synDefaults(), 's');
  renderForm($<HTMLFormElement>('params-form'), PARAM_GROUPS, paramDefaults(), 'p');
  if (vizOn) selectTab('generate');
  clearRunViz();
  drawDataView();
  $('viz-ready').hidden = !vizOn;
};

document.addEventListener('keydown', (e) => {
  if (!player.active || e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.key === ' ' && tag === 'BUTTON') return; // the button handles it
  if (player.key(e)) e.preventDefault();
});

$('btn-run').onclick = () => {
  const params = currentParams();
  const errors = checkParams(params);
  if (errors.length) {
    setStatus(errors.join(' '), 'error');
    return;
  }
  busy = 'run';
  runParams = params;
  timing = { phase: '', start: performance.now() };
  setStatus('Starting…');
  clearRunViz();
  updateButtons();
  send({ type: 'run', params, trace: vizOn });
};

$('btn-cancel').onclick = () => {
  worker.terminate();
  busy = null;
  startWorker();
  setStatus('Cancelled.');
  if (exclusionSource) send({ type: 'exclusion', source: exclusionSource });
  if (sources) {
    // the new worker needs the data again
    busy = 'load';
    send({ type: 'load', normal: sources.normal, tumor: sources.tumor, testShare: currentParams().testShare || DEFAULT_PARAMS.testShare });
  }
  updateButtons();
};

$('btn-dl-combos').onclick = () => lastResult && download('greedy_combinations.csv', combinationsCsv(lastResult));
$('btn-dl-metrics').onclick = () => lastResult && download('greedy_scores.csv', metricsCsv(lastResult, sources?.label ?? '', exclusionInfo));

// ---------- offline ----------
const badge = $('offline-status');
function showOnline() {
  if (!navigator.onLine) {
    badge.hidden = false;
    badge.textContent = 'You are offline. The page keeps working.';
  }
}
window.addEventListener('offline', showOnline);
window.addEventListener('online', () => (badge.textContent = 'Saved for offline use.'));
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker
    .register('./sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(() => {
      badge.hidden = false;
      badge.textContent = navigator.onLine ? 'Saved for offline use: you can turn off the internet and keep using this page.' : 'You are offline. The page keeps working.';
    })
    .catch(() => {
      badge.hidden = false;
      badge.textContent = 'Offline use is not available in this browser.';
    });
}
showOnline();
