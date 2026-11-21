// The package from CommonJS: require gives the same tools, and one call of each kind runs on the live API.
const { datacircleTools, bestPlans, VERSION } = require('@datacircle/lmstudio');

(async () => {
  const tools = datacircleTools();
  const best = tools[1];
  best.checkParameters({ slug: 'serp', limit: 2 });
  const answer = await best.implementation({ slug: 'serp', limit: 2 }, { signal: new AbortController().signal });
  const alone = await bestPlans({ slug: 'serp', limit: 1 });
  const ok = answer.plans?.length === 2 && alone.plans?.length === 1 && VERSION === '0.1.0';
  console.log(`${ok ? 'ok  ' : 'FAIL'} require: ${tools.map((t) => t.name).join(',')}; serp ${answer.plans?.map((p) => p.provider).join(' / ')}`);
  process.exit(ok ? 0 : 1);
})();
