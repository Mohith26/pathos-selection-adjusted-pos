# Selection-adjusted probability of success for Pathos Scout (concept demo)

**Live demo:** https://mohith26.github.io/pathos-selection-adjusted-pos/

Scout ranks investigational therapies against the patient subgroups most likely to benefit and shortlists the
highest-confidence bets, and Foundry keeps "continuously updated probability-of-success calculations". This demo adds
one view to that loop: a shortlist review that corrects each opportunity's PoS for the fact that it was *selected*
because its evidence looked best (the winner's curse), before a Sprint Pod commits a trial.

Unofficial concept demo by Mohith Gajjela. Not affiliated with Pathos AI. Computational only, and all data are
synthetic: assets, subgroups, evidence and outcomes are simulated; mechanism and biomarker names are generic.

## The problem

When hundreds of (therapy x subgroup) estimates are ranked, the top of the list is enriched for estimates whose noise
happened to point the right way: small subgroups, residual confounding in real-world evidence, many looks. PoS numbers
computed from those estimates are optimistic exactly where the decision is made. Accounting for each estimate's own
standard error does not fix it, because the error is in the selection, not in any single estimate.

## Method

1. **RWE bias calibration.** 40 past programs with both a real-world-evidence estimate and a randomized readout give the
   mean RWE offset and the residual bias SD (method of moments on the differences, subtracting both sampling variances).
   The offset is removed and the bias SD is added to every estimate's noise.
2. **Learn the distribution of true effects from all candidates.** Kiefer-Wolfowitz nonparametric maximum likelihood
   (EM on a 161-point grid of log hazard ratios) over all 720 opportunities, each with its own noise
   (sampling SE^2 + bias variance). The losers are what tell you how rare a real hazard ratio of 0.45 is.
3. **Posterior per opportunity.** Posterior mean and 90% interval for the true hazard ratio, P(true HR < 0.80), and
   **adjusted PoS = posterior expected power** (assurance) of the planned randomized trial
   (1:1, D events, one-sided alpha 0.025, power = Phi(-theta / (2/sqrt(D)) - 1.96)).
4. **Baseline for comparison (unadjusted PoS):** predictive probability of success with a flat prior, i.e. the same
   trial power averaged over N(estimate, SE^2). It already accounts for each estimate's uncertainty; it only ignores
   selection.
5. **Validation where the truth is known.** `scripts/validate.mjs` simulates 100 candidate sets (seeds 1000-1099), takes
   the top k by unadjusted and by adjusted PoS, and simulates one randomized trial per shortlisted opportunity at its
   true effect.

## Results (100 simulated candidate sets, 150-event trials, top 10)

| | Mean predicted PoS | Realized success |
|---|---|---|
| Shortlist by unadjusted PoS: unadjusted prediction | 96% | 58% |
| Same shortlist: adjusted prediction | 58% | 58% |
| Shortlist chosen by adjusted PoS | 64% (adjusted) | 67% |

Brier score on the unadjusted-ranked shortlists: 0.251 adjusted vs 0.383 unadjusted. Across all nine designs on the page
(120/150/250 events x top 5/10/20) the unadjusted PoS overstates realized success by 19-42 points, the adjusted PoS is
within 0-6 points (slightly conservative), and ranking by adjusted PoS raises realized success by 4-10 points. The reliability diagram on the page is honest about
the residual miscalibration: the adjusted PoS is somewhat conservative in its lowest bins and a little optimistic in its
highest.

## Run it

Static page, no build step: open `index.html`. The selected candidate set is generated and analyzed in the browser
(~0.1 s); the simulation study is precomputed by `scripts/validate.mjs` with the same core. The default candidate set
(seed 2027) is the one of the five offered whose top-10 adjusted PoS and true power sit closest to the study averages,
so the first view is typical rather than flattering; the others are one click away. Append `#truth=1` to the URL to
show the simulated true hazard ratios.

```
node --test tests/core.test.mjs   # 10 tests
node scripts/validate.mjs         # regenerates data/validation.js(on)
```

Tests cover the normal CDF, trial power, bias calibration recovering a planted bias SD, NPMLE recovering a two-point
mixture with a monotone EM likelihood, shrinkage ordering (noisy estimates shrink more), assurance equal to power under
a point mass, determinism and a check that the analysis never reads the simulated truth, the shortlist correction
direction, and the simulation-study calibration claim.

## Honest limitations

* Everything is synthetic. The generator (asset-level effects, sparse biomarker modifiers, subgroup sizes 40-600,
  RWE confounding at asset and subgroup level) is a stated assumption; the correction is only as good as the
  exchangeability of the candidates it learns from. In practice the prior should be learned within comparable
  strata (tumor type, modality) or with covariates.
* Subgroups of the same asset share patients in reality; here their noise is independent apart from a shared asset bias.
* The NPMLE prior is discrete by nature, so many top opportunities share similar posterior means; a smoothed
  (log-spline) g-model would give smoother output. Per-portfolio calibration varies; the 100-portfolio average is the claim.
* Bias calibration assumes past programs are representative of current RWE bias.
* PoS here is statistical success of one randomized trial, not regulatory or commercial success.

## Novelty note

Empirical Bayes correction of the winner's curse (Efron, "Tweedie's formula and selection bias", 2011), NPMLE
g-modeling (Koenker and Mizera), assurance (O'Hagan et al.), and RWE-vs-RCT calibration (e.g. RCT-DUPLICATE, Schuemie
et al.) are established. Pathos's public materials describe Scout's ranking and Foundry's continuously updated PoS but
nothing about adjusting PoS for selection across the candidate set; I did not find a public drug-development platform
that reports selection-adjusted PoS on its shortlist with a simulation check. This is a concept for where it could sit.

## Layout

`src/core.js` (generator, calibration, NPMLE, posteriors, assurance, validation) · `src/app.js` (UI) ·
`assets/app.css` (Pathos design tokens) · `tests/` · `scripts/validate.mjs` · `data/validation.js`.

MIT License.
