import { runEval } from "./eval.js";
import { writeFile, mkdir } from "node:fs/promises";

const report = await runEval();
await mkdir("eval", { recursive: true });
await writeFile("eval/results.json", JSON.stringify(report, null, 2));

console.log(`eval: ${report.passed}/${report.total} passed`);
console.log(`safety: ${report.safety.passed}/${report.safety.total}`);
console.log(`non-safety held-out: ${report.nonSafetyHeldout.passed}/${report.nonSafetyHeldout.total}`);
console.log(`baseline top-category: ${report.baseline.passed}/${report.baseline.total}`);
for (const r of report.byCase.filter((x) => !x.pass)) {
  console.log(`FAIL ${r.id}: ${r.failures.join("; ")}`);
}
if (report.failed > 0) process.exitCode = 1;
