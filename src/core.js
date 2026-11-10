// Selection-adjusted probability of success for an opportunity ranking (concept for Pathos Scout).
// No dependencies; runs in the browser and under `node --test`.
//
// Problem: a ranking engine scores hundreds of (therapy x patient subgroup) opportunities from real-world evidence and
// shortlists the best. Every estimate is noisy (small subgroups, residual confounding), and the shortlist is, by
// construction, the set whose noise happened to look best (the winner's curse). Probability-of-success numbers computed
// from those point estimates are therefore optimistic exactly where decisions are made.
//
// Method:
//  1. Calibrate real-world-evidence bias against past programs that have both an RWE estimate and a randomized readout
//     (method of moments on the RWE-minus-RCT differences).
//  2. Learn the distribution of TRUE effects across ALL candidates (not just the winners) by nonparametric maximum
//     likelihood (Kiefer-Wolfowitz NPMLE on a grid, EM), with each estimate's own noise = sampling SE^2 + bias variance.
//  3. Each opportunity's posterior given its estimate is selection-proof (the prior already knows how rare large effects
//     are); PoS for a planned randomized trial = posterior expected power (assurance).
//  4. Validate by simulation, where the truth is known: predicted vs realized trial success, naive vs adjusted.

// ---------- RNG ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function gauss(rnd) {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------- normal helpers ----------
export function normCdf(x) { // Abramowitz-Stegun 7.1.26 via erf, |err| < 1.5e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
export const normPdf = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
export const Z975 = 1.959963984540054;

// ---------- synthetic portfolio ----------
// Each mechanism is only paired with tumor types where it is plausibly developed.
const MECH_TUMORS = {
  "KRAS G12C inhibitor": ["NSCLC", "CRC", "Pancreatic"], "TROP2 ADC": ["NSCLC", "Breast (HR+)", "Gastric"],
  "PARP inhibitor": ["Ovarian", "Prostate", "Breast (HR+)", "Pancreatic"], "CDK4/6 inhibitor": ["Breast (HR+)", "NSCLC"],
  "EZH2 inhibitor": ["Prostate", "Multiple myeloma", "Ovarian"], "MET TKI": ["NSCLC", "Gastric", "CRC"],
  "ER degrader": ["Breast (HR+)"], "PD-1 x VEGF bispecific": ["NSCLC", "CRC", "Gastric", "Ovarian"],
  "PI3K-alpha inhibitor": ["Breast (HR+)", "Ovarian", "CRC"], "WEE1 inhibitor": ["Ovarian", "Pancreatic", "NSCLC"],
  "ATR inhibitor": ["Ovarian", "Prostate", "NSCLC"], "Menin inhibitor": ["Multiple myeloma", "Prostate"],
  "HER3 ADC": ["NSCLC", "Breast (HR+)", "CRC"], "PRMT5 inhibitor": ["NSCLC", "Pancreatic", "Multiple myeloma"],
  "CBP/p300 inhibitor": ["Prostate", "Multiple myeloma", "Breast (HR+)"], "B7-H3 ADC": ["Prostate", "NSCLC", "Ovarian"],
  "SHP2 inhibitor": ["NSCLC", "CRC", "Pancreatic"], "AKT inhibitor": ["Breast (HR+)", "Prostate"],
  "FGFR inhibitor": ["Gastric", "NSCLC", "Breast (HR+)"], "Claudin 18.2 ADC": ["Gastric", "Pancreatic"],
};
const MECHS = Object.keys(MECH_TUMORS);
const TUMORS = {
  NSCLC: ["all-comers", "STK11-mut", "KEAP1-mut", "PD-L1 <1%", "EGFR-mut post-TKI", "MET amp", "TP53-mut", "squamous"],
  "Breast (HR+)": ["all-comers", "ESR1-mut", "PIK3CA-mut", "post-CDK4/6", "HER2-low", "Ki-67 high"],
  CRC: ["all-comers", "KRAS G12C", "MSS", "RAS wild-type", "liver-only mets"],
  Prostate: ["all-comers", "AR-V7+", "HRR-mut", "post-ARPI", "PTEN loss"],
  Ovarian: ["all-comers", "BRCA-wt", "platinum-resistant", "HRD+"],
  Pancreatic: ["all-comers", "KRAS G12D", "2L+"],
  Gastric: ["all-comers", "CLDN18.2 high", "HER2-neg"],
  "Multiple myeloma": ["all-comers", "t(11;14)", "triple-class exposed"],
};

export const DEFAULTS = {
  nAssets: 80, subgroupsPerAsset: 9, nHistory: 40,
  pActive: 0.3, activeMean: -0.25, activeSd: 0.1, inactiveSd: 0.05, // asset-level true log-HR
  pModifier: 0.15, modifierMean: -0.2, modifierSd: 0.1,               // biomarker-driven extra benefit in a subgroup
  biasAssetSd: 0.06, biasSubgroupSd: 0.05,                            // residual confounding in real-world evidence
  eventsPerPatient: 0.6,
};

export function genPortfolio(seed, o = DEFAULTS) {
  const rnd = mulberry32(seed), g = () => gauss(rnd);
  const opps = [];
  for (let j = 0; j < o.nAssets; j++) {
    const active = rnd() < o.pActive;
    const a = active ? o.activeMean + o.activeSd * g() : o.inactiveSd * g();
    const bAsset = o.biasAssetSd * g();
    const mech = MECHS[j % MECHS.length];
    const code = "SC-" + String(101 + j * 7 + Math.floor(rnd() * 5)).padStart(3, "0");
    const used = new Set();
    for (let k = 0; k < o.subgroupsPerAsset; k++) {
      let tumor, sub, key, tries = 0;
      do {
        const allowed = MECH_TUMORS[mech];
        tumor = allowed[Math.floor(rnd() * allowed.length)];
        const subs = TUMORS[tumor];
        sub = subs[Math.floor(rnd() * subs.length)];
        key = tumor + "|" + sub;
      } while (used.has(key) && ++tries < 50);
      used.add(key);
      const mod = sub !== "all-comers" && rnd() < o.pModifier ? o.modifierMean + o.modifierSd * g() : 0;
      const theta = Math.max(-1.2, a + mod);
      const n = Math.round(Math.exp(Math.log(40) + rnd() * (Math.log(600) - Math.log(40)))); // 40..600 exposed patients
      const events = Math.max(8, Math.round(n * o.eventsPerPatient * (0.8 + 0.4 * rnd())));
      const se = 2 / Math.sqrt(events);
      const bias = bAsset + o.biasSubgroupSd * g();
      const est = theta + bias + se * g();
      opps.push({ id: opps.length, asset: code, mech, tumor, subgroup: sub, n, events, se, theta, bias, est, active });
    }
  }
  // past programs with both an RWE estimate and a randomized readout (for bias calibration)
  const history = [];
  for (let h = 0; h < o.nHistory; h++) {
    const theta = rnd() < o.pActive ? o.activeMean + o.activeSd * g() : o.inactiveSd * g();
    const events = Math.round(80 + rnd() * 400), seR = 2 / Math.sqrt(events);
    const rctEvents = Math.round(150 + rnd() * 350), seT = 2 / Math.sqrt(rctEvents);
    const bias = o.biasAssetSd * g() + o.biasSubgroupSd * g();
    history.push({ rwe: theta + bias + seR * g(), seRwe: seR, rct: theta + seT * g(), seRct: seT });
  }
  return { seed, opps, history };
}

// ---------- 1. bias calibration ----------
// Var(rwe - rct) = tau^2 + seRwe^2 + seRct^2  ->  tau^2 = mean(d^2 - seRwe^2 - seRct^2) (truncated at 0); also mean bias.
export function calibrateBias(history) {
  const n = history.length;
  const d = history.map((h) => h.rwe - h.rct);
  const mean = d.reduce((a, b) => a + b, 0) / n;
  const tau2 = Math.max(0, history.reduce((s, h, i) => s + (d[i] - mean) ** 2 - h.seRwe ** 2 - h.seRct ** 2, 0) / (n - 1));
  return { mean, tau: Math.sqrt(tau2), n };
}

// ---------- 2. NPMLE of the effect distribution ----------
export function makeGrid(lo = -1.4, hi = 0.6, m = 161) { return Array.from({ length: m }, (_, i) => lo + (i * (hi - lo)) / (m - 1)); }

export function npmle(est, sd, grid = makeGrid(), { iters = 400, tol = 1e-7 } = {}) {
  const n = est.length, m = grid.length;
  const L = new Float64Array(n * m);
  for (let i = 0; i < n; i++) for (let g = 0; g < m; g++) L[i * m + g] = normPdf((est[i] - grid[g]) / sd[i]) / sd[i];
  let w = new Float64Array(m).fill(1 / m), ll = -Infinity, it = 0;
  const marg = new Float64Array(n);
  for (; it < iters; it++) {
    let newLL = 0;
    for (let i = 0; i < n; i++) { let s = 0; for (let g = 0; g < m; g++) s += w[g] * L[i * m + g]; marg[i] = s; newLL += Math.log(s); }
    const nw = new Float64Array(m);
    for (let i = 0; i < n; i++) { const inv = 1 / marg[i]; for (let g = 0; g < m; g++) nw[g] += w[g] * L[i * m + g] * inv; }
    for (let g = 0; g < m; g++) nw[g] /= n;
    w = nw;
    if (Math.abs(newLL - ll) < tol * Math.abs(newLL)) { ll = newLL; break; }
    ll = newLL;
  }
  return { grid, w: Array.from(w), loglik: ll, iters: it };
}

// ---------- 3. posteriors, PoS ----------
export function posterior(prior, est, sd) {
  const { grid, w } = prior, p = grid.map((t, g) => w[g] * normPdf((est - t) / sd));
  const z = p.reduce((a, b) => a + b, 0);
  return p.map((v) => v / z);
}
export function postSummary(prior, post, level = 0.9) {
  const g = prior.grid;
  let mean = 0; for (let i = 0; i < g.length; i++) mean += post[i] * g[i];
  const q = (p) => { let c = 0; for (let i = 0; i < g.length; i++) { c += post[i]; if (c >= p) return g[i]; } return g[g.length - 1]; };
  return { mean, lo: q((1 - level) / 2), hi: q(1 - (1 - level) / 2) };
}
// Power of a 1:1 randomized trial with D events, one-sided alpha 0.025, at true log-HR theta (benefit = negative).
export const trialSe = (events) => 2 / Math.sqrt(events);
export const power = (theta, events) => normCdf(-theta / trialSe(events) - Z975);
export const pointPower = (est, events) => power(est, events);
// Unadjusted PoS: predictive probability of trial success that accounts for the estimate's own uncertainty but not for
// selection (flat prior): P(trial z < -1.96) with the effect ~ N(est, se^2). This is the fair baseline.
export const naivePos = (est, seEst, events) => normCdf((-est - Z975 * trialSe(events)) / Math.sqrt(trialSe(events) ** 2 + seEst ** 2));
export function assurance(prior, post, events) { let s = 0; for (let i = 0; i < prior.grid.length; i++) s += post[i] * power(prior.grid[i], events); return s; }

// Full analysis of one portfolio as the platform would run it (no access to the truth).
export function analyze(pf, { trialEvents = 250, shortlist = 10, rankBy = "naive" } = {}) {
  const cal = calibrateBias(pf.history);
  const est = pf.opps.map((o) => o.est - cal.mean);
  const sd = pf.opps.map((o) => Math.sqrt(o.se ** 2 + cal.tau ** 2));
  const prior = npmle(est, sd);
  const rows = pf.opps.map((o, i) => {
    const post = posterior(prior, est[i], sd[i]);
    const s = postSummary(prior, post);
    return {
      ...o, estAdj: est[i], sdTot: sd[i],
      naive: naivePos(est[i], sd[i], trialEvents), point: pointPower(o.est, trialEvents), adjusted: assurance(prior, post, trialEvents),
      postMean: s.mean, lo: s.lo, hi: s.hi,
      naiveLo: o.est - 1.645 * o.se, naiveHi: o.est + 1.645 * o.se,
      pBenefit: post.reduce((a, p, g) => a + (prior.grid[g] < Math.log(0.8) ? p : 0), 0), // P(true HR < 0.8)
    };
  });
  const byNaive = [...rows].sort((a, b) => b.naive - a.naive || a.est - b.est);
  const byAdj = [...rows].sort((a, b) => b.adjusted - a.adjusted || a.postMean - b.postMean);
  byNaive.forEach((r, i) => (r.rankNaive = i + 1));
  byAdj.forEach((r, i) => (r.rankAdj = i + 1));
  return { cal, prior, rows, byNaive, byAdj, shortlist: (rankBy === "naive" ? byNaive : byAdj).slice(0, shortlist), trialEvents };
}

// ---------- 4. validation by simulation (truth known) ----------
// For each simulated portfolio: shortlist top-k by naive PoS and by adjusted PoS; run one randomized trial per shortlisted
// opportunity at its TRUE effect; compare predicted with realized success.
export function validate(seeds, { trialEvents = 250, shortlist = 10, trialSeed = 99 } = {}) {
  const out = { naiveList: [], adjList: [], trueTheta: { naive: [], adj: [] } };
  for (const seed of seeds) {
    const pf = genPortfolio(seed), A = analyze(pf, { trialEvents, shortlist });
    const rnd = mulberry32(seed * 7919 + trialSeed);
    const runTrial = (r) => r.theta + trialSe(trialEvents) * gauss(rnd) < -Z975 * trialSe(trialEvents);
    const trials = new Map();
    const outcome = (r) => { if (!trials.has(r.id)) trials.set(r.id, runTrial(r)); return trials.get(r.id); }; // same trial if on both lists
    for (const r of A.byNaive.slice(0, shortlist)) out.naiveList.push({ seed, naive: r.naive, point: r.point, adjusted: r.adjusted, success: outcome(r), theta: r.theta, truePower: power(r.theta, trialEvents) });
    for (const r of A.byAdj.slice(0, shortlist)) out.adjList.push({ seed, naive: r.naive, point: r.point, adjusted: r.adjusted, success: outcome(r), theta: r.theta, truePower: power(r.theta, trialEvents) });
  }
  const mean = (a, f) => a.reduce((s, x) => s + f(x), 0) / a.length;
  const summary = (L) => ({
    n: L.length,
    predNaive: mean(L, (x) => x.naive), predPoint: mean(L, (x) => x.point), predAdj: mean(L, (x) => x.adjusted),
    realized: mean(L, (x) => (x.success ? 1 : 0)), truePower: mean(L, (x) => x.truePower),
    brierNaive: mean(L, (x) => (x.naive - (x.success ? 1 : 0)) ** 2), brierAdj: mean(L, (x) => (x.adjusted - (x.success ? 1 : 0)) ** 2),
  });
  return { ...out, naive: summary(out.naiveList), adj: summary(out.adjList) };
}

// Reliability diagram: bin predictions, report mean prediction and realized success rate per bin.
export function reliability(list, key, edges = [0, 0.2, 0.4, 0.6, 0.8, 0.9, 1.0001]) {
  return edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1], xs = list.filter((x) => x[key] >= lo && x[key] < hi);
    return { lo, hi, n: xs.length, pred: xs.length ? xs.reduce((s, x) => s + x[key], 0) / xs.length : null,
      obs: xs.length ? xs.filter((x) => x.success).length / xs.length : null };
  });
}
