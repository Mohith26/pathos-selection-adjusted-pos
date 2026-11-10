// Simulation study behind the page's "Does it hold up?" section. Same core as the page.
// For each design (trial events x shortlist size): 100 synthetic portfolios (seeds 1000-1099), shortlist by unadjusted
// and by adjusted PoS, one randomized trial per shortlisted opportunity at its TRUE effect.
// Usage: node scripts/validate.mjs  -> data/validation.js (window.PATHOS_VALIDATION) + data/validation.json
import fs from "node:fs";
import * as C from "../src/core.js";
const seeds = Array.from({ length: 100 }, (_, i) => 1000 + i);
const out = { seeds: [seeds[0], seeds[seeds.length - 1]], designs: {} };
for (const ev of [120, 150, 250]) for (const k of [5, 10, 20]) {
  const V = C.validate(seeds, { trialEvents: ev, shortlist: k });
  out.designs[`${ev}|${k}`] = {
    unadjustedRanked: V.naive, adjustedRanked: V.adj,
    reliabilityUnadjusted: C.reliability(V.naiveList, "naive"),
    reliabilityAdjusted: C.reliability(V.naiveList, "adjusted"),
  };
  console.log(ev, k, "unadj-ranked: pred", V.naive.predNaive.toFixed(3), "adj-pred", V.naive.predAdj.toFixed(3), "realized", V.naive.realized.toFixed(3), "| adj-ranked realized", V.adj.realized.toFixed(3));
}
const dir = new URL("../data/", import.meta.url);
fs.writeFileSync(new URL("validation.json", dir), JSON.stringify(out));
fs.writeFileSync(new URL("validation.js", dir), "window.PATHOS_VALIDATION=" + JSON.stringify(out) + ";\n");
