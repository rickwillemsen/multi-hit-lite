# Multi-hit gene combinations

A browser-based tool for identifying **multi-hit gene combinations**: sets of genes that may drive cancer. This greedy heuristic selects a set of gene combinations that together cover as many tumor samples as possible, while covering as few normal samples as possible. This tool runs entirely in the web browser on a laptop. No supercomputer, GPU, optimization solver, or installation is required, and after the first visit the tool also works offline.

**Live version:** https://rickwillemsen.github.io/multi-hit-lite/

## References

- This tool is based on [arXiv:2610.09420](https://arxiv.org/abs/2610.09420). If you use this tool in your research, please cite that publication.
- A more advanced method, which requires optimization solvers (CPLEX or Google OR-Tools), was introduced at CP 2026: [10.4230/LIPIcs.CP.2026.57](https://doi.org/10.4230/LIPIcs.CP.2026.57). Its implementation is publicly available at
[github.com/rickwillemsen/MHCDSCP](https://github.com/rickwillemsen/MHCDSCP).

## Features

- **Synthetic data generator.** Creates a tumor and a normal dataset of any size with planted gene combinations,
  so you can see how well the method recovers them. The generated files can be downloaded.
- **Upload your own data.** Two CSV files (normal and tumor samples) plus an optional list of genes to exclude.
- **Input validation.** Every file is checked before a run; problems are reported with file name and line number.
- **Train/test evaluation.** The data is split into a training set and a held-out test set, stratified by class
  (tumor and normal samples are split separately). Gene combinations are selected on the training set and evaluated
  on both sets.
- **Reproducible.** Every run is controlled by a random seed; the same data and settings give the same result.
- **Private by design.** Files are read and processed locally in the browser and are never uploaded.
- **Offline use.** The page is stored by the browser on the first visit and keeps working without an internet
  connection.

## Method

A sample is *covered* by a gene combination when every gene in the gene combination is mutated in that sample.
The goal is a small set of combinations that covers many tumor samples and few normal samples:

```
objective = (number of tumor samples covered) − (number of normal coverings)
```

where a normal sample counts once for every combination that covers it.

1. **Split.** Tumor and normal samples are each divided at random into a training set and a test set
   (stratified random sampling: both classes keep the same proportions in each set).
2. **Candidate generation.** From the most frequently mutated genes in the training tumor samples, random
   combinations with a size in the chosen range are drawn. A gene combination is kept as a candidate if it covers at
   least one training tumor sample.
3. **Greedy selection.** Candidates are ranked by the number of tumor samples they cover. Combinations are then
   added one at a time, each time choosing the one that increases the objective most. The procedure stops when
   the maximum number of gene combinations is reached or the objective no longer improves.
4. **Evaluation.** A sample is predicted *tumor* when at least one selected gene combination covers it. The page
   reports TP, TN, FP, FN, MCC, specificity, sensitivity and F1 for the training and test sets.

## Input format

Two CSV files, one with normal samples and one with tumor samples:

```
numberOfGenes,numberOfSamples
0,ENSG00000141510,0,1,0,0,1
1,ENSG00000171862,1,1,0,0,0
2,ENSG00000157764,0,0,0,1,0
```

- The first line gives the number of genes and the number of samples.
- Each following line describes one gene: row number (starting at 0), gene ID, then one value per sample
  (`1` = mutated, `0` = not mutated).
- Both files must list the same genes in the same order. The number of samples may differ.

### Exclusion list (optional)

A text or CSV file with one gene ID per line, spelled exactly as in the data files. If a line contains several
columns (separated by comma, semicolon or tab), the first column is used. Empty lines and lines starting with `#`
are ignored. Excluded genes are treated as never mutated.

## Parameters

| Setting | Default | Description |
| --- | --- | --- |
| Smallest / largest size | 2 / 3 | Range of the number of genes per gene combination |
| Maximum number in the result | 10 | Upper limit on the number of selected gene combinations |
| Genes to choose from | 100 | The most frequently mutated tumor genes, from which candidate gene combinations are drawn |
| Random gene combinations to try | 100,000 | Number of distinct candidate gene combinations to generate |
| Share of samples used for testing | 0.25 | Size of the test set |
| Random seed | 42 | Seed for the split and the candidate generation |

## Output

- The selected gene combinations in the order they were added, with the objective, the number of tumor samples
  covered and the number of normal coverings after each step.
- Performance scores on the training and test sets.
- Both can be downloaded as CSV files, together with the settings of the run.

## Project structure

```
index.html                  page layout
src/main.ts                 user interface
src/worker.ts               runs the computation in a background thread
src/sw-template.js          service worker for offline use
src/core/
  csv.ts                    reading and validating the data files
  exclusionList.ts          reading the exclusion list
  synthetic.ts              synthetic data generator
  data.ts, instance.ts      gene × sample matrices and the train/test split
  generateGreedyGeneCombinations.ts   candidate generation
  greedy.ts                 greedy selection
  metrics.ts                performance scores
  pipeline.ts               complete run, from split to scores
  random.ts                 seeded random number generator
tests/                      tests of the input validation
```
