// Step-by-step visualization of the method, for small datasets.
import type { VizTrace } from './core/pipeline';
import type { DataPreview } from './protocol';

const COLORS = ['#66b2ff', '#66cc00', '#ffb366', '#c39bd3', '#ff8a80', '#4dd0c4', '#ffd54f', '#9fa8ff', '#f48fb1', '#aed581', '#ffab91', '#80deea'];
export const colorOf = (k: number) => COLORS[k % COLORS.length];

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const sym = (letter: string, i: number) => `<i>${letter}</i><sub>${i}</sub>`;
const CROSS = '<svg class="vx" viewBox="0 0 36 30" aria-hidden="true"><line x1="5" y1="4" x2="31" y2="26"/><line x1="31" y1="4" x2="5" y2="26"/></svg>';

interface Row {
  label: string; // e.g. t3
  cls: 't' | 'n';
  values: number[];
}

interface Highlight {
  genes: number[];
  color: string;
}

interface CandidateRow {
  k: number;
  genes: number[];
  dim?: boolean;
  side: string[]; // already formatted cells
  bestSide?: number; // index of the side cell to highlight
}

interface MatrixOptions {
  geneIds: string[];
  excluded: Set<number>;
  rows: Row[];
  combos?: Highlight[]; // colored in the rows they cover
  light?: Highlight | null; // lit for a moment: label and cells of covered rows
  crossed?: Set<string>;
  tags?: Map<string, string>;
  candTitle?: string;
  cands?: CandidateRow[];
  sideHead?: string[];
}

const covers = (values: number[], genes: number[], excluded: Set<number>) => genes.length > 0 && genes.every((g) => !excluded.has(g) && values[g] === 1);

function matrixHtml(o: MatrixOptions): string {
  const G = o.geneIds.length;
  const nSide = o.sideHead?.length ?? 0;
  let h = '<table class="vm"><thead><tr><th></th>';
  for (let g = 0; g < G; g++) h += `<th class="vg${o.excluded.has(g) ? ' exc' : ''}" title="${esc(o.geneIds[g])}${o.excluded.has(g) ? ' (on the exclusion list)' : ''}">${sym('g', g + 1)}</th>`;
  h += `<th class="vtag"></th>${'<th></th>'.repeat(nSide)}</tr></thead><tbody>`;
  for (const r of o.rows) {
    const cellColor = new Map<number, string>();
    for (const c of o.combos ?? []) if (covers(r.values, c.genes, o.excluded)) for (const g of c.genes) cellColor.set(g, c.color);
    const lit = o.light && covers(r.values, o.light.genes, o.excluded);
    if (lit) for (const g of o.light!.genes) cellColor.set(g, o.light!.color);
    const n = Number(r.label.slice(1));
    h += `<tr><th class="vl ${r.cls}${lit ? ' lit' : ''}"${lit ? ` style="--lit:${o.light!.color}"` : ''}>${sym(r.label[0], n)}${o.crossed?.has(r.label) ? CROSS : ''}</th>`;
    for (let g = 0; g < G; g++) {
      const ex = o.excluded.has(g);
      const col = !ex && cellColor.get(g);
      h += `<td class="${ex ? 'exc' : col ? 'on' : ''}"${col ? ` style="background:${col}"` : ''}>${ex ? 0 : r.values[g]}</td>`;
    }
    const tag = o.tags?.get(r.label);
    h += `<td class="vtag">${tag ? `<span class="tag ${tag}">${tag}</span>` : ''}</td>${'<td class="vside"></td>'.repeat(nSide)}</tr>`;
  }
  if (o.cands) {
    h += `<tr class="vgap"><td colspan="${G + 2 + nSide}"></td></tr>`;
    h += `<tr class="vsec"><td></td><td colspan="${G}">${esc(o.candTitle ?? '')}</td><td></td>${(o.sideHead ?? []).map((x) => `<th class="vside">${x}</th>`).join('')}</tr>`;
    for (const c of o.cands) {
      const col = colorOf(c.k);
      h += `<tr class="vcand${c.dim ? ' dim' : ''}" data-cand="${c.k}"><th class="vcl" style="background:${col}">${sym('c', c.k + 1)}</th>`;
      for (let g = 0; g < G; g++) h += c.genes.includes(g) ? `<td class="vcg" style="background:${col}"></td>` : '<td class="vce"></td>';
      h += '<td></td>';
      if (c.side.length === 1 && nSide > 1) h += `<td class="vside note" colspan="${nSide}">${c.side[0]}</td>`;
      else h += c.side.map((x, i) => `<td class="vside${c.bestSide === i ? ' best' : ''}">${x}</td>`).join('');
      h += '</tr>';
    }
  }
  return h + '</tbody></table>';
}

const head = (title: string) => `<h4 class="vhead">${esc(title)}</h4>`;

function rowsOf(matrix: number[][], idx: number[] | null, letter: 't' | 'n'): Row[] {
  const list = idx ?? matrix.map((_, i) => i);
  return list.map((i) => ({ label: letter + (i + 1), cls: letter, values: matrix[i] }));
}

// ---------- data view ----------
export function renderDataView(el: HTMLElement, p: DataPreview | null, tooLarge: string) {
  if (!p) {
    el.innerHTML = `<p class="hint viz-note">${esc(tooLarge)}</p>`;
    return;
  }
  const excluded = new Set(p.excluded);
  el.innerHTML = `<div class="viz">${head('Mutation matrix (samples × genes)')}<div class="vscroll">${matrixHtml({
    geneIds: p.geneIds,
    excluded,
    rows: [...rowsOf(p.tumor, null, 't'), ...rowsOf(p.normal, null, 'n')],
  })}</div><p class="hint">Rows are samples (${sym('t', 1)}, ${sym('t', 2)}, … tumor; ${sym('n', 1)}, ${sym('n', 2)}, … normal), columns are genes (hover over ${sym('g', 1)}, ${sym('g', 2)}, … for the gene ID). A 1 means the gene is mutated in that sample.${
    excluded.size ? ' Red columns are genes on the exclusion list; they are treated as never mutated.' : ''
  }</p></div>`;
}

// ---------- method view (candidates, then greedy rounds) ----------
type Frame = { kind: 'cand'; k: number } | { kind: 'round'; r: number } | { kind: 'done' };

export class MethodPlayer {
  private t: VizTrace | null = null;
  private beta = 0;
  private stopReason = '';
  private frames: Frame[] = [];
  private i = 0;
  private timer: number | undefined;
  private playing = false;
  private hover: number | null = null;
  private speed = 1;
  private readonly body: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly counter: HTMLElement;

  constructor(private readonly el: HTMLElement) {
    el.innerHTML = `<div class="viz"><div class="vctrl">
        <button type="button" data-a="back" title="Previous step (←)">⏮ Back</button>
        <button type="button" data-a="play" title="Play or pause (space)">▶ Play</button>
        <button type="button" data-a="next" title="Next step (→)">Next ⏭</button>
        <label>Speed <select data-a="speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
        <button type="button" data-a="replay">↺ Replay</button>
        <span class="vcount"></span>
      </div><div class="vbody"></div></div>`;
    this.body = el.querySelector('.vbody')!;
    this.playBtn = el.querySelector('[data-a="play"]')!;
    this.counter = el.querySelector('.vcount')!;
    el.querySelector('.vctrl')!.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('button')?.dataset.a;
      if (a === 'back') this.step(-1);
      else if (a === 'next') this.step(1);
      else if (a === 'play') this.toggle();
      else if (a === 'replay') this.replay();
    });
    el.querySelector<HTMLSelectElement>('[data-a="speed"]')!.onchange = (e) => {
      this.speed = Number((e.target as HTMLSelectElement).value);
      if (this.playing) this.schedule();
    };
    this.body.addEventListener('mouseover', (e) => {
      const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-cand]');
      const k = tr ? Number(tr.dataset.cand) : null;
      if (k !== this.hover) {
        this.hover = k;
        this.render();
      }
    });
    this.body.addEventListener('mouseleave', () => {
      if (this.hover !== null) {
        this.hover = null;
        this.render();
      }
    });
  }

  get active() {
    return this.t !== null;
  }

  load(t: VizTrace, beta: number, stopReason: string) {
    this.t = t;
    this.beta = beta;
    this.stopReason = stopReason;
    this.frames = [...t.candidates.map((_, k) => ({ kind: 'cand' as const, k })), ...t.rounds.map((_, r) => ({ kind: 'round' as const, r })), { kind: 'done' }];
    this.i = 0;
    this.hover = null;
    this.el.hidden = false;
    this.render();
    this.play();
  }

  clear() {
    this.pause();
    this.t = null;
    this.el.hidden = true;
  }

  key(e: KeyboardEvent): boolean {
    if (!this.t) return false;
    if (e.key === 'ArrowRight') this.step(1);
    else if (e.key === 'ArrowLeft') this.step(-1);
    else if (e.key === ' ') this.toggle();
    else return false;
    return true;
  }

  private step(d: number) {
    this.pause();
    this.go(this.i + d);
  }

  private go(i: number) {
    this.i = Math.max(0, Math.min(this.frames.length - 1, i));
    this.render();
  }

  private toggle() {
    if (this.playing) this.pause();
    else {
      if (this.i >= this.frames.length - 1) this.i = 0;
      this.play();
    }
  }

  private replay() {
    this.i = 0;
    this.render();
    this.play();
  }

  private play() {
    this.playing = true;
    this.playBtn.textContent = '⏸ Pause';
    this.schedule();
  }

  private pause() {
    this.playing = false;
    this.playBtn.textContent = '▶ Play';
    clearTimeout(this.timer);
  }

  private schedule() {
    clearTimeout(this.timer);
    const f = this.frames[this.i];
    const base = f?.kind === 'cand' ? 700 : 1800;
    this.timer = window.setTimeout(() => {
      if (this.i >= this.frames.length - 1) return this.pause();
      this.go(this.i + 1);
      if (this.i >= this.frames.length - 1) this.pause();
      else this.schedule();
    }, base / this.speed);
  }

  private render() {
    const t = this.t;
    if (!t) return;
    const trainNote = `<p class="vsub">Training set only: ${t.tumorTrain.length} tumor and ${t.normalTrain.length} normal samples. The test samples are held back and used in the results.</p>`;
    const f = this.frames[this.i];
    this.counter.textContent = `step ${this.i + 1} of ${this.frames.length}`;
    const excluded = new Set(t.excluded);
    const rows = [...rowsOf(t.tumor, t.tumorTrain, 't'), ...rowsOf(t.normal, t.normalTrain, 'n')];
    const coverCount = (genes: number[], cls: 't' | 'n') => rows.filter((r) => r.cls === cls && covers(r.values, genes, excluded)).length;
    const hoverLight = this.hover !== null ? { genes: t.candidates[this.hover], color: colorOf(this.hover) } : null;
    const base = { geneIds: t.geneIds, excluded, rows };

    if (f.kind === 'cand') {
      const k = f.k;
      const cands: CandidateRow[] = t.candidates.slice(0, k + 1).map((genes, j) => ({ k: j, genes, side: [String(coverCount(genes, 't')), String(coverCount(genes, 'n'))] }));
      this.body.innerHTML = `${head(`Method, part 1: candidate gene combinations (${k + 1} of ${t.candidates.length})`)}${trainNote}<div class="vscroll">${matrixHtml({
        ...base,
        light: hoverLight ?? { genes: t.candidates[k], color: colorOf(k) },
        candTitle: 'Candidate gene combinations',
        cands,
        sideHead: ['tumor<br />covered', 'normal<br />covered'],
      })}</div><p class="hint">Random gene combinations are drawn from the most frequently mutated tumor genes; only those that cover at least one tumor sample in the training set are kept (shown here). The newest one, ${sym('c', k + 1)}, lights up the training samples it covers.</p>`;
      return;
    }

    const roundsDone = f.kind === 'done' ? t.rounds.length : f.r;
    const added: number[] = [];
    const addedIn = new Map<number, number>();
    const objectives: number[] = [];
    for (let r = 0; r < roundsDone; r++) {
      const c = t.rounds[r].chosen;
      if (c >= 0) {
        added.push(c);
        addedIn.set(c, r + 1);
        objectives.push(t.rounds[r].objective);
      }
    }
    const crossed = new Set(rows.filter((r) => added.some((c) => covers(r.values, t.candidates[c], excluded))).map((r) => r.label));
    const combos = added.map((c) => ({ genes: t.candidates[c], color: colorOf(c) }));

    if (f.kind === 'round') {
      const round = t.rounds[f.r];
      const evals = new Map(round.evals.map((e) => [e[0], e]));
      const cands: CandidateRow[] = t.candidates.map((genes, k) => {
        if (addedIn.has(k)) return { k, genes, dim: true, side: [`added in round ${addedIn.get(k)}`] };
        const e = evals.get(k);
        if (!e) return { k, genes, side: ['–', '–', '–'] };
        return { k, genes, side: [String(e[1]), String(e[2]), String(e[3])], bestSide: k === round.chosen ? 2 : undefined };
      });
      const prevObjective = objectives.length ? objectives[objectives.length - 1] : 0;
      const what =
        round.chosen >= 0
          ? `${sym('c', round.chosen + 1)} has the largest gain (${evals.get(round.chosen)?.[3]}) and is added. The objective goes from ${prevObjective} to ${round.objective}.`
          : 'No candidate improves the objective, so the search stops.';
      const skipped = t.candidates.length - added.length - round.evals.length;
      this.body.innerHTML = `${head(`Method, part 2: greedy selection, round ${f.r + 1}`)}${trainNote}<div class="vrow"><div class="vscroll">${matrixHtml({
        ...base,
        combos,
        crossed,
        light: hoverLight ?? (round.chosen >= 0 ? { genes: t.candidates[round.chosen], color: colorOf(round.chosen) } : null),
        candTitle: 'Candidate gene combinations',
        cands,
        sideHead: ['new<br />tumor', 'normal', 'gain'],
      })}</div><div class="vside-panel"><p><b>Round ${f.r + 1}:</b> ${what}</p><p class="hint">Gain = new tumor samples covered − normal coverings. An ✕ marks samples already covered by the chosen gene combinations.${
        skipped > 0 ? ' “–” = not checked this round: it cannot cover more new tumor samples than the best one found so far.' : ''
      }</p>${chart(objectives, round.chosen >= 0 ? round.objective : null, this.beta, null, t.tumorTrain.length)}</div></div>`;
      return;
    }

    // done
    const stop = this.stopReason.replace(/\.$/, '');
    this.body.innerHTML = `${head('Method: finished')}${trainNote}<div class="vrow"><div class="vscroll">${matrixHtml({
      ...base,
      combos,
      crossed,
      light: hoverLight,
      candTitle: 'Selected gene combinations',
      cands: added.map((k, j) => ({ k, genes: t.candidates[k], side: [`added in round ${j + 1}`] })),
      sideHead: [''],
    })}</div><div class="vside-panel"><p><b>Stopped:</b> ${esc(stop)}. ${added.length} gene combination${added.length === 1 ? ' was' : 's were'} selected; the results below show how well they classify the training and test samples.</p>${chart(objectives, null, this.beta, stop, t.tumorTrain.length)}</div></div>`;
  }
}

/** Objective per round. `pending` is the value this round would add (open dot). */
function chart(objectives: number[], pending: number | null, beta: number, stopLabel: string | null, yTop: number): string {
  const W = 340;
  const H = 200;
  const L = 40;
  const R = 14;
  const T = 16;
  const B = 36;
  const pts = [0, ...objectives];
  const all = pending === null ? pts : [...pts, pending];
  const xMax = Math.max(all.length - 1, Math.min(beta, Math.max(all.length, 5)));
  const lo = Math.min(0, ...all);
  const hi = Math.max(1, yTop, ...all);
  const stepY = Math.max(1, Math.ceil((hi - lo) / 5));
  const yMax = hi; // the objective can never exceed the number of training tumor samples
  const yMin = Math.floor(lo / stepY) * stepY;
  const x = (i: number) => L + ((W - L - R) * i) / xMax;
  const y = (v: number) => H - B - ((H - B - T) * (v - yMin)) / (yMax - yMin || 1);
  let s = `<svg class="vchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Objective per round">`;
  const ticks: number[] = [];
  for (let v = yMin; v < yMax - stepY / 2; v += stepY) ticks.push(v);
  ticks.push(yMax);
  for (const v of ticks) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  const xStep = Math.max(1, Math.ceil(xMax / 10));
  for (let i = 0; i <= xMax; i += xStep) s += `<text x="${x(i)}" y="${H - B + 15}" text-anchor="middle">${i}</text>`;
  s += `<line class="axis" x1="${L}" x2="${W - R}" y1="${y(yMin)}" y2="${y(yMin)}"/><line class="axis" x1="${L}" x2="${L}" y1="${T}" y2="${y(yMin)}"/>`;
  if (beta <= xMax) s += `<line class="max" x1="${x(beta)}" x2="${x(beta)}" y1="${T}" y2="${y(yMin)}"/><text class="maxl" x="${x(beta) - 4}" y="${y(yMin) - 6}" text-anchor="end">maximum round (${beta})</text>`;
  s += `<polyline class="line" points="${pts.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>`;
  s += pts.map((v, i) => `<circle class="dot" cx="${x(i)}" cy="${y(v)}" r="4"/>`).join('');
  if (pending !== null) {
    const i = pts.length;
    s += `<line class="pend" x1="${x(i - 1)}" y1="${y(pts[i - 1])}" x2="${x(i)}" y2="${y(pending)}"/><circle class="open" cx="${x(i)}" cy="${y(pending)}" r="4"/>`;
  }
  if (stopLabel) {
    const i = pts.length - 1;
    s += `<text class="stopl" x="${Math.min(x(i) + 8, W - R)}" y="${y(pts[i]) - 9}" text-anchor="${x(i) > W / 2 ? 'end' : 'start'}">stop</text>`;
  }
  s += `<text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">round</text><text x="11" y="${(T + H - B) / 2}" transform="rotate(-90 11 ${(T + H - B) / 2})" text-anchor="middle">objective</text></svg>`;
  return s;
}

// ---------- solution view ----------
export function renderSolution(el: HTMLElement, t: VizTrace) {
  let hover: number | null = null;
  const excluded = new Set(t.excluded);
  const draw = () => {
    const sel = t.chosen;
    const combos = sel.map((c) => ({ genes: t.candidates[c], color: colorOf(c) }));
    const light = hover !== null ? { genes: t.candidates[hover], color: colorOf(hover) } : null;
    const block = (title: string, tumorIdx: number[], normalIdx: number[], withList: boolean) => {
      const rows = [...rowsOf(t.tumor, tumorIdx, 't'), ...rowsOf(t.normal, normalIdx, 'n')];
      if (!rows.length) return '';
      const crossed = new Set<string>();
      const tags = new Map<string, string>();
      let tp = 0, fp = 0, tn = 0, fn = 0;
      for (const r of rows) {
        const pos = sel.some((c) => covers(r.values, t.candidates[c], excluded));
        if (pos) crossed.add(r.label);
        const tag = r.cls === 't' ? (pos ? 'TP' : 'FN') : pos ? 'FP' : 'TN';
        tags.set(r.label, tag);
        if (tag === 'TP') tp++;
        else if (tag === 'FP') fp++;
        else if (tag === 'TN') tn++;
        else fn++;
      }
      return `<div class="vblock">${head(title)}<div class="vscroll">${matrixHtml({
        geneIds: t.geneIds,
        excluded,
        rows,
        combos,
        crossed,
        tags,
        light,
        ...(withList ? { candTitle: 'Selected gene combinations', cands: sel.map((k) => ({ k, genes: t.candidates[k], side: [] })), sideHead: [] } : {}),
      })}</div><p class="hint">TP = ${tp}, FN = ${fn}, TN = ${tn}, FP = ${fp}</p></div>`;
    };
    el.innerHTML = `<div class="viz"><div class="vrow">${block('Training set', t.tumorTrain, t.normalTrain, true)}${block('Test set', t.tumorTest, t.normalTest, true)}</div><p class="hint">A sample is predicted tumor (marked with an ✕) when at least one selected gene combination covers it. TP = tumor sample predicted tumor, FN = tumor sample missed, TN = normal sample predicted normal, FP = normal sample predicted tumor.</p></div>`;
  };
  el.onmouseover = (e) => {
    const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-cand]');
    const k = tr ? Number(tr.dataset.cand) : null;
    if (k !== hover) {
      hover = k;
      draw();
    }
  };
  el.onmouseleave = () => {
    if (hover !== null) {
      hover = null;
      draw();
    }
  };
  el.hidden = false;
  draw();
}
