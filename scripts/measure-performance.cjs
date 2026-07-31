const { performance } = require("node:perf_hooks");

const baseUrl = String(process.env.ESPORTE_FAI_BENCHMARK_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const samples = Math.max(5, Number(process.env.ESPORTE_FAI_BENCHMARK_SAMPLES || 30));

function percentile(values, target) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * target) - 1)];
}

(async () => {
  const timings = [];
  for (let index = 0; index < samples; index += 1) {
    const startedAt = performance.now();
    const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Health check falhou com HTTP ${response.status}.`);
    await response.arrayBuffer();
    timings.push(performance.now() - startedAt);
  }

  console.log(JSON.stringify({
    endpoint: `${baseUrl}/api/health`,
    samples,
    p50Ms: Number(percentile(timings, 0.5).toFixed(2)),
    p95Ms: Number(percentile(timings, 0.95).toFixed(2)),
    maximumMs: Number(Math.max(...timings).toFixed(2))
  }, null, 2));
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
