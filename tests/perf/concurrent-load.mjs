import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const BASE = process.env.TRUSTGUARD_WEB_URL ?? 'http://127.0.0.1:3100';
const CONCURRENCY_LEVELS = [1, 5, 10, 20];
const TOTAL_PER_STAGE = 25;

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(2));
}

async function actorCookie(actorName) {
  const res = await fetch(`${BASE}/api/bff/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ actorName }),
  });
  const setCookie = res.headers.get('set-cookie');
  return setCookie ? setCookie.split(';')[0] : '';
}

async function runStage(targetUrl, concurrency, totalRequests, cookie) {
  const latencies = [];
  let ok = 0;
  let rateLimited429 = 0;
  let failed = 0;
  let nextIdx = 0;
  const stageStart = performance.now();

  async function worker() {
    while (true) {
      const idx = nextIdx++;
      if (idx >= totalRequests) return;
      const t0 = performance.now();
      try {
        const res = await fetch(targetUrl, cookie ? { headers: { cookie } } : undefined);
        await res.arrayBuffer();
        const elapsed = performance.now() - t0;
        latencies.push(elapsed);
        if (res.status >= 200 && res.status < 300) ok++;
        else if (res.status === 429) rateLimited429++;
        else failed++;
      } catch {
        latencies.push(performance.now() - t0);
        failed++;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const totalSec = Math.max(0.001, (performance.now() - stageStart) / 1000);
  latencies.sort((a, b) => a - b);
  const avg = latencies.reduce((s, v) => s + v, 0) / Math.max(1, latencies.length);

  return {
    concurrency,
    totalRequests,
    ok,
    rateLimited429,
    failed,
    errorRate: Number(((failed + rateLimited429) / totalRequests).toFixed(4)),
    rps: Number((totalRequests / totalSec).toFixed(2)),
    avgMs: Number(avg.toFixed(2)),
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
  };
}

async function main() {
  const viewerCookie = await actorCookie('cell-viewer');
  const packCookie = await actorCookie('pack-viewer');
  const recycleCookie = await actorCookie('recycle-viewer');
  const labCookie = await actorCookie('lab-viewer');

  const assetsRes = await fetch(`${BASE}/api/bff/assets`, { headers: { cookie: viewerCookie } });
  const assetsJson = await assetsRes.json();
  const sampleCode = assetsJson.assets?.[0]?.code ?? 'DMAPB010000001E114616111';

  const targets = [
    {
      name: 'bff_assets_index',
      path: '/api/bff/assets',
      desc: 'PostgreSQL 资产台账读取 (via BFF, within 120 req/min/actor limit)',
      cookie: viewerCookie,
    },
    {
      name: 'bff_battery_fabric_query',
      path: `/api/bff/battery?code=${encodeURIComponent(sampleCode)}`,
      desc: '24位码按码实时查询链码+健康+生命周期 (via BFF mTLS -> Fabric)',
      cookie: packCookie,
    },
    {
      name: 'bff_dashboard_summary',
      path: '/api/bff/dashboard',
      desc: '安全驾驶舱综合统计与拓扑接口 (via BFF mTLS)',
      cookie: recycleCookie,
    },
  ];

  const results = [];
  for (const t of targets) {
    const stages = [];
    for (const c of CONCURRENCY_LEVELS) {
      stages.push(await runStage(`${BASE}${t.path}`, c, TOTAL_PER_STAGE, t.cookie));
    }
    const cleanStages = stages.map(s => s);
    results.push({ name: t.name, path: t.path, desc: t.desc, stages: cleanStages });
    const last = cleanStages.at(-1);
    console.log(`[BENCH] ${t.name}: c=20 rps=${last.rps}, p50=${last.p50Ms}ms, p95=${last.p95Ms}ms, ok=${last.ok}/${last.totalRequests}`);
  }

  // Dedicated Rate-Limit Verification: burst 135 GETs under lab-viewer (>120/min threshold)
  const burst = await runStage(`${BASE}/api/bff/assets`, 20, 135, labCookie);
  console.log(`[RATE_LIMIT_CHECK] burst=135 -> ok=${burst.ok}, HTTP429=${burst.rateLimited429}`);

  const report = {
    generatedAt: new Date().toISOString(),
    environment: 'local single-host WSL2 (4 Fabric peers + 1 Raft orderer + NestJS mTLS API + Next.js BFF)',
    limitations: 'Local single-machine concurrency benchmark within API 120 reads/min/actor ceiling; not multi-host production capacity.',
    totalPerStage: TOTAL_PER_STAGE,
    concurrencyLevels: CONCURRENCY_LEVELS,
    rateLimitThresholdPerActorMinute: 120,
    rateLimitBurstProof: burst,
    targets: results,
  };

  const outFile = path.resolve(import.meta.dirname, '../../docs/reports/concurrency-benchmark.json');
  await writeFile(outFile, JSON.stringify(report, null, 2) + '\n');
  console.log(`Concurrency benchmark saved to ${outFile}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
