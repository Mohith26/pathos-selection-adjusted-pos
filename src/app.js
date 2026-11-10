import * as C from "./core.js";

const $ = (id) => document.getElementById(id);
const VAL = window.PATHOS_VALIDATION;
// Default candidate set: 2027, the one whose top-10 adjusted PoS (53%) and true power (58%) sit closest to the
// 100-portfolio study averages (58% / 58%), so the first view is typical rather than flattering.
const SEEDS = [2027, 2026, 2028, 2029, 2030];
const state = { seed: 2027, ev: 150, k: 10, rank: "naive", truth: false, open: 0 };
for (const [k, v] of new URLSearchParams(location.hash.slice(1))) {
  if (k === "seed" && SEEDS.includes(+v)) state.seed = +v;
  if (k === "ev" && ["120", "150", "250"].includes(v)) state.ev = +v;
  if (k === "k" && ["5", "10", "20"].includes(v)) state.k = +v;
  if (k === "rank" && ["naive", "adjusted"].includes(v)) state.rank = v;
  if (k === "truth") state.truth = v === "1";
}

// decorative dotted ring (pipeline-page motif)
$("h-n").textContent = "720";
(() => {
  let s = "";
  for (const [r, n] of [[28, 16], [20, 12], [12, 8]]) for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n + r; s += `<circle cx="${32 + r * Math.cos(a)}" cy="${32 + r * Math.sin(a)}" r="2.6" fill="#B7E4E2"/>`;
  }
  document.querySelector(".ring").innerHTML = s;
})();

const pct = (v) => (v > 0.995 ? ">99%" : v < 0.005 ? "<1%" : Math.round(100 * v) + "%");
const hr = (lt) => Math.exp(lt).toFixed(2);

$("sel-seed").innerHTML = SEEDS.map((s, i) => `<option value="${s}"${s === state.seed ? " selected" : ""}>Oncology candidates, review ${String.fromCharCode(65 + i)} (seed ${s})</option>`).join("");
$("sel-ev").value = String(state.ev); $("sel-k").value = String(state.k); $("sel-rank").value = state.rank; $("chk-truth").checked = state.truth;
$("sel-seed").onchange = (e) => { state.seed = +e.target.value; state.open = 0; render(); };
$("sel-ev").onchange = (e) => { state.ev = +e.target.value; render(); };
$("sel-k").onchange = (e) => { state.k = +e.target.value; render(); };
$("sel-rank").onchange = (e) => { state.rank = e.target.value; state.open = 0; render(); };
$("chk-truth").onchange = (e) => { state.truth = e.target.checked; render(); };

// chart styling: Pathos palette, light hairlines, no default blues
Chart.defaults.font.family = "'Albert Sans','Helvetica Neue',Arial,sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.color = "#5F6B70";
Chart.defaults.animation = false;
Object.assign(Chart.defaults.plugins.tooltip, { backgroundColor: "#244A54", cornerRadius: 0, padding: 10, titleFont: { weight: "600" } });
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.color = "#181D24";
const grid = { color: "#E3E8EA" }, border = { color: "#181D24" };
const charts = {};
const draw = (id, cfg) => { if (charts[id]) charts[id].destroy(); charts[id] = new Chart($(id), cfg); };
const legend = { position: "top", align: "start", labels: { boxWidth: 8, boxHeight: 8, padding: 14 } };

let pf = null, pfSeed = null;
function render() {
  if (pfSeed !== state.seed) { pf = C.genPortfolio(state.seed); pfSeed = state.seed; }
  const A = C.analyze(pf, { trialEvents: state.ev, shortlist: state.k, rankBy: state.rank });
  const list = A.shortlist;
  const inNaive = new Set(A.byNaive.slice(0, state.k).map((r) => r.id)), inAdj = new Set(A.byAdj.slice(0, state.k).map((r) => r.id));

  // shortlist rows
  $("list").innerHTML = list.map((r, i) => {
    const filled = Math.round(r.adjusted * 20), lost = Math.max(0, Math.round(r.naive * 20) - filled);
    const dots = Array.from({ length: 20 }, (_, d) => `<i class="d${d < filled ? " f" : d < filled + lost ? " g" : ""}"></i>`).join("");
    const other = state.rank === "naive" ? r.rankAdj : r.rankNaive;
    const mine = state.rank === "naive" ? r.rankNaive : r.rankAdj;
    const mv = state.rank === "naive"
      ? (other > state.k ? `<span class="mv down">adjusted rank ${other}</span>` : `<span class="mv up">adjusted rank ${other}</span>`)
      : (inNaive.has(r.id) ? `<span class="mv up">unadjusted rank ${other}</span>` : `<span class="mv up">new: was rank ${other}</span>`);
    return `<div class="row" data-i="${i}">
      <div><div class="nm"><span class="rank">#${mine}</span><b>${r.asset}</b> ${r.mech}</div>
        <div class="meta">${r.tumor} &middot; ${r.subgroup} ${mv}</div></div>
      <div class="cells">
        <div><div class="big">${r.n}</div><div class="ci">pts &middot; ${r.events} events</div></div>
        <div><div class="big">${hr(r.est)}</div><div class="ci">${hr(r.naiveLo)} to ${hr(r.naiveHi)}</div></div>
        <div><div class="big">${hr(r.postMean)}</div><div class="ci">${hr(r.lo)} to ${hr(r.hi)}</div>${state.truth ? `<div class="truth">simulated truth ${hr(r.theta)}</div>` : ""}</div>
        <div class="pos"><div class="dots">${dots}</div><div class="nums"><s>${pct(r.naive)}</s> &rarr; <b>${pct(r.adjusted)}</b> adjusted</div></div>
      </div></div>
      <div class="panel${state.open === i ? " open" : ""}" id="p${i}">
        <div class="pgrid">
          <div><div class="k">Bias-calibrated RWE</div><div class="v">HR ${hr(r.estAdj)}</div><div class="s">raw ${hr(r.est)}; total SD ${r.sdTot.toFixed(3)} (sampling ${r.se.toFixed(3)} + bias ${A.cal.tau.toFixed(3)})</div></div>
          <div><div class="k">Posterior P(true HR &lt; 0.80)</div><div class="v">${pct(r.pBenefit)}</div><div class="s">from the learned effect distribution</div></div>
          <div><div class="k">Point-estimate power</div><div class="v">${pct(r.point)}</div><div class="s">if the RWE estimate were the truth</div></div>
          <div><div class="k">Ranks</div><div class="v">#${r.rankNaive} unadjusted &middot; #${r.rankAdj} adjusted</div><div class="s">of ${A.rows.length} candidates</div></div>
        </div>
        <div class="pr" style="margin-top:18px"><span class="lab">Additional Information</span><span class="plus">&minus;</span></div>
      </div>`;
  }).join("");
  document.querySelectorAll(".row").forEach((el) => (el.onclick = () => { const i = +el.dataset.i; state.open = state.open === i ? -1 : i; render(); }));

  // shrinkage scatter
  const all = A.rows, shortIds = new Set(list.map((r) => r.id));
  const mean = (a, f) => a.reduce((s, x) => s + f(x), 0) / a.length;
  const topN = A.byNaive.slice(0, state.k);
  $("shrink-sub").textContent = `The unadjusted top ${state.k} report a median RWE hazard ratio of ${hr(median(topN.map((r) => r.est)))}; after adjustment the median is ${hr(median(topN.map((r) => r.postMean)))}. Small subgroups with extreme estimates move the most.`;
  const pts = (rows) => rows.map((r) => ({ x: Math.exp(r.est), y: Math.exp(r.postMean), r }));
  draw("c-shrink", { type: "scatter", data: { datasets: [
    { label: "Shortlist", data: pts(all.filter((r) => shortIds.has(r.id))), backgroundColor: "#244A54", pointRadius: 5, order: 1 },
    ...(state.truth ? [{ label: "Simulated truth (shortlist)", data: list.map((r) => ({ x: Math.exp(r.est), y: Math.exp(r.theta) })), backgroundColor: "#E2C94B", pointStyle: "rectRot", pointRadius: 5, order: 0 }] : []),
    { label: `All ${all.length} candidates`, data: pts(all.filter((r) => !shortIds.has(r.id))), backgroundColor: "rgba(48,93,105,.22)", pointRadius: 2.5, order: 2 },
    { label: "No adjustment", type: "line", data: [{ x: 0.25, y: 0.25 }, { x: 2, y: 2 }], borderColor: "#9AA6AA", borderDash: [5, 4], borderWidth: 1, pointRadius: 0, order: 3 },
  ] }, options: { maintainAspectRatio: false, plugins: { legend, tooltip: { callbacks: { label: (c) => c.raw.r ? ` ${c.raw.r.asset} ${c.raw.r.tumor} · ${c.raw.r.subgroup}: RWE ${c.raw.x.toFixed(2)} → ${c.raw.y.toFixed(2)}` : ` ${c.raw.x.toFixed(2)} → ${c.raw.y.toFixed(2)}` } } },
    scales: { x: { type: "logarithmic", min: 0.25, max: 2, grid, border, title: { display: true, text: "RWE hazard ratio (log scale)" }, ticks: { callback: (v) => [0.25, 0.5, 0.75, 1, 1.5, 2].includes(+v.toFixed(2)) ? v : "" } },
      y: { type: "logarithmic", min: 0.4, max: 1.6, grid, border, title: { display: true, text: "Adjusted hazard ratio" }, ticks: { callback: (v) => [0.4, 0.5, 0.6, 0.75, 1, 1.25, 1.5].includes(+v.toFixed(2)) ? v : "" } } } } });

  // learned prior vs raw estimates
  const edges = []; for (let x = -1.4; x <= 0.61; x += 0.1) edges.push(+x.toFixed(2));
  const binOf = (t) => Math.min(edges.length - 2, Math.max(0, Math.floor((t + 1.4) / 0.1)));
  const hEst = new Array(edges.length - 1).fill(0), hPri = new Array(edges.length - 1).fill(0);
  all.forEach((r) => hEst[binOf(r.estAdj)] += 1 / all.length);
  A.prior.grid.forEach((t, g) => hPri[binOf(t)] += A.prior.w[g]);
  // compare at the shortlist's own cutoff: how many estimates clear it vs how many true effects the learned distribution expects there
  const cut = A.byNaive[state.k - 1].estAdj;
  const nEst = all.filter((r) => r.estAdj <= cut).length;
  const nTrue = all.length * A.prior.grid.reduce((s, t, g) => s + (t <= cut ? A.prior.w[g] : 0), 0);
  $("prior-sub").textContent = `${nEst} of ${all.length} candidates have a bias-calibrated RWE hazard ratio at or below the top-${state.k} cutoff (${hr(cut)}). The effect distribution learned from all of them, net of each estimate's noise, expects ${nTrue < 1 ? "fewer than 1" : "about " + Math.round(nTrue)} true effects that strong. The shortlist is mostly selected noise on top of real but smaller effects.`;
  draw("c-prior", { type: "bar", data: { labels: edges.slice(0, -1).map((e) => Math.exp(e + 0.05).toFixed(2)), datasets: [
    { label: "RWE estimates (bias-calibrated)", data: hEst.map((v) => 100 * v), backgroundColor: "rgba(48,93,105,.25)", borderColor: "#305D69", borderWidth: 1, barPercentage: 1, categoryPercentage: 0.95 },
    { label: "Learned distribution of true effects", data: hPri.map((v) => 100 * v), backgroundColor: "#B7E4E2", borderColor: "#244A54", borderWidth: 1, barPercentage: 0.55, categoryPercentage: 0.95 },
  ] }, options: { maintainAspectRatio: false, plugins: { legend, tooltip: { callbacks: { title: (c) => `HR ≈ ${c[0].label}`, label: (c) => ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)}%` } } },
    scales: { x: { grid: { display: false }, border, title: { display: true, text: "Hazard ratio (bin centre)" }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } }, y: { grid, border, title: { display: true, text: "% of candidates" } } } } });

  // validation (precomputed by scripts/validate.mjs with the same core)
  const V = VAL.designs[`${state.ev}|${state.k}`];
  const u = V.unadjustedRanked, a = V.adjustedRanked;
  $("val-sub").textContent = `100 simulated candidate sets (seeds ${VAL.seeds[0]}-${VAL.seeds[1]}) where the true effects are known. For each, the top ${state.k} were taken by unadjusted PoS and by adjusted PoS, and one ${state.ev}-event randomized trial was simulated per opportunity at its true effect.`;
  $("kpis").innerHTML = [
    ["Unadjusted PoS promised", pct(u.predNaive), `mean over ${u.n} shortlisted opportunities`],
    ["Trials actually succeeded", pct(u.realized), "same shortlists, simulated readouts"],
    ["Adjusted PoS predicted", pct(u.predAdj), `Brier ${u.brierAdj.toFixed(3)} vs ${u.brierNaive.toFixed(3)} unadjusted`],
    ["Ranking by adjusted PoS", pct(a.realized), `realized success (+${Math.round(100 * (a.realized - u.realized))} pts)`],
  ].map(([k, v, s]) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join("");
  const relPts = (bins) => bins.filter((b) => b.n >= 15).map((b) => ({ x: b.pred, y: b.obs, n: b.n }));
  draw("c-rel", { type: "scatter", data: { datasets: [
    { label: "Adjusted PoS", data: relPts(V.reliabilityAdjusted), backgroundColor: "#244A54", borderColor: "#244A54", showLine: true, pointRadius: 5 },
    { label: "Unadjusted PoS", data: relPts(V.reliabilityUnadjusted), backgroundColor: "#E2C94B", borderColor: "#C9AE2E", showLine: true, pointRadius: 6, pointStyle: "rectRot" },
    { label: "Perfect calibration", type: "line", data: [{ x: 0, y: 0 }, { x: 1, y: 1 }], borderColor: "#9AA6AA", borderDash: [5, 4], borderWidth: 1, pointRadius: 0 },
  ] }, options: { maintainAspectRatio: false, plugins: { legend, tooltip: { callbacks: { label: (c) => ` predicted ${pct(c.raw.x)}, realized ${pct(c.raw.y)}${c.raw.n ? ` (n=${c.raw.n})` : ""}` } } },
    scales: { x: { min: 0, max: 1, grid, border, title: { display: true, text: "Predicted PoS" }, ticks: { callback: (v) => Math.round(100 * v) + "%" } }, y: { min: 0, max: 1, grid, border, title: { display: true, text: "Realized success" }, ticks: { callback: (v) => Math.round(100 * v) + "%" } } } } });
  draw("c-hit", { type: "bar", data: { labels: ["Shortlist by unadjusted PoS", "Shortlist by adjusted PoS"], datasets: [
    { label: "Unadjusted PoS (predicted)", data: [u.predNaive, a.predNaive].map((v) => 100 * v), backgroundColor: "#fff", borderColor: "#244A54", borderWidth: 1, borderDash: [3, 3] },
    { label: "Adjusted PoS (predicted)", data: [u.predAdj, a.predAdj].map((v) => 100 * v), backgroundColor: "#B7E4E2", borderColor: "#244A54", borderWidth: 1 },
    { label: "Realized success", data: [u.realized, a.realized].map((v) => 100 * v), backgroundColor: "#244A54" },
  ] }, options: { maintainAspectRatio: false, plugins: { legend, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y.toFixed(0)}%` } } },
    scales: { x: { grid: { display: false }, border }, y: { min: 0, max: 100, grid, border, ticks: { callback: (v) => v + "%" } } } } });

  // bias calibration
  $("cal").innerHTML = `<div><div class="k">Past programs used</div><div class="v">${A.cal.n}</div><div class="s">each with an RWE estimate and a randomized readout</div></div>
    <div><div class="k">Average RWE offset vs randomized</div><div class="v">${A.cal.mean >= 0 ? "+" : ""}${A.cal.mean.toFixed(3)} log-HR</div><div class="s">RWE hazard ratios ran ${A.cal.mean >= 0 ? "higher" : "lower"} than the randomized readouts by a factor of ${Math.exp(A.cal.mean).toFixed(3)} on average; removed before ranking</div></div>
    <div><div class="k">Residual bias SD</div><div class="v">${A.cal.tau.toFixed(3)} log-HR</div><div class="s">added to every estimate's noise, so even very large subgroups are never treated as certain</div></div>`;
  console.info("scout analysis rendered", list.length, "rows");
}
function median(a) { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
document.fonts.ready.then(render);
