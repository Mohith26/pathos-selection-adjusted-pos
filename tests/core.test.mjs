import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../src/core.js";

test("normal CDF matches known values", () => {
  assert.ok(Math.abs(C.normCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(C.normCdf(1.959964) - 0.975) < 1e-6);
  assert.ok(Math.abs(C.normCdf(-1) - 0.158655) < 1e-6);
});

test("trial power: null effect gives alpha, strong benefit gives ~1, and more events give more power", () => {
  assert.ok(Math.abs(C.power(0, 150) - 0.025) < 1e-6);
  assert.ok(C.power(Math.log(0.4), 150) > 0.99);
  assert.ok(C.power(Math.log(0.75), 300) > C.power(Math.log(0.75), 150));
});

test("bias calibration recovers the planted RWE bias spread", () => {
  const rnd = C.mulberry32(5), g = () => C.gauss(rnd), hist = [];
  for (let i = 0; i < 4000; i++) {
    const th = -0.2 * rnd(), se1 = 0.1 + 0.1 * rnd(), se2 = 0.1 + 0.05 * rnd();
    hist.push({ rwe: th + 0.03 + 0.08 * g() + se1 * g(), seRwe: se1, rct: th + se2 * g(), seRct: se2 });
  }
  const c = C.calibrateBias(hist);
  assert.ok(Math.abs(c.mean - 0.03) < 0.01);
  assert.ok(Math.abs(c.tau - 0.08) < 0.015);
});

test("NPMLE recovers a two-point mixture and EM never decreases the likelihood", () => {
  const rnd = C.mulberry32(11), est = [], sd = [];
  for (let i = 0; i < 2000; i++) { const t = rnd() < 0.3 ? -0.5 : 0; const s = 0.1 + 0.1 * rnd(); est.push(t + s * C.gauss(rnd)); sd.push(s); }
  const a = C.npmle(est, sd, C.makeGrid(), { iters: 20, tol: 0 }), b = C.npmle(est, sd, C.makeGrid(), { iters: 200, tol: 0 });
  assert.ok(b.loglik >= a.loglik - 1e-9);
  const massNear = (p, c) => p.grid.reduce((s, t, i) => s + (Math.abs(t - c) < 0.12 ? p.w[i] : 0), 0);
  assert.ok(Math.abs(massNear(b, -0.5) - 0.3) < 0.06);
  assert.ok(Math.abs(massNear(b, 0) - 0.7) < 0.06);
  assert.ok(Math.abs(b.w.reduce((x, y) => x + y, 0) - 1) < 1e-9);
});

test("posterior shrinks extreme, noisy estimates more than precise ones", () => {
  const prior = { grid: C.makeGrid(), w: null };
  prior.w = prior.grid.map((t) => Math.exp(-0.5 * ((t + 0.1) / 0.15) ** 2)); const z = prior.w.reduce((a, b) => a + b); prior.w = prior.w.map((v) => v / z);
  const noisy = C.postSummary(prior, C.posterior(prior, -0.9, 0.35)), precise = C.postSummary(prior, C.posterior(prior, -0.9, 0.08));
  assert.ok(noisy.mean > precise.mean); // pulled further toward the prior centre
  assert.ok(precise.mean > -0.9 && noisy.mean > -0.9);
  assert.ok(noisy.lo < noisy.mean && noisy.mean < noisy.hi);
});

test("assurance under a point-mass prior equals power", () => {
  const grid = [-0.3, 0], prior = { grid, w: [1, 0] }, post = [1, 0];
  assert.ok(Math.abs(C.assurance(prior, post, 150) - C.power(-0.3, 150)) < 1e-12);
});

test("portfolio generator is deterministic and the analysis never reads the truth", () => {
  const a = C.genPortfolio(42), b = C.genPortfolio(42);
  assert.deepEqual(a, b);
  assert.equal(a.opps.length, 720);
  const A1 = C.analyze(a);
  const scrambled = { ...a, opps: a.opps.map((o) => ({ ...o, theta: 99, bias: 99, active: null })) };
  const A2 = C.analyze(scrambled);
  assert.deepEqual(A1.rows.map((r) => [r.naive, r.adjusted, r.rankAdj]), A2.rows.map((r) => [r.naive, r.adjusted, r.rankAdj]));
});

test("adjusted PoS on the shortlist is lower than unadjusted PoS (winner's curse correction)", () => {
  const A = C.analyze(C.genPortfolio(2026), { trialEvents: 150, shortlist: 10 });
  const top = A.byNaive.slice(0, 10);
  assert.ok(top.every((r) => r.adjusted < r.naive));
  assert.ok(top.every((r) => r.postMean > r.estAdj)); // shrunk toward no effect
});

test("simulation study: adjusted PoS is close to realized success, unadjusted is not, and adjusted ranking hits more", () => {
  const V = C.validate(Array.from({ length: 20 }, (_, i) => 500 + i), { trialEvents: 150, shortlist: 10 });
  assert.ok(Math.abs(V.naive.predAdj - V.naive.realized) < 0.1);
  assert.ok(V.naive.predNaive - V.naive.realized > 0.2);
  assert.ok(V.adj.realized > V.naive.realized);
  assert.ok(V.naive.brierAdj < V.naive.brierNaive);
});

test("reliability bins partition the list", () => {
  const list = [{ p: 0.1, success: false }, { p: 0.5, success: true }, { p: 0.95, success: true }, { p: 1, success: false }];
  const r = C.reliability(list, "p");
  assert.equal(r.reduce((s, b) => s + b.n, 0), list.length);
});
