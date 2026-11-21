// Each tool's own call on the live API, as model.act() makes it: the model's input through its checkParameters, whose refusal
// the model reads as the call's result, then its implementation with the act's signal; and the answers a model's mistakes
// get. npm test
import { bestPlans, datacircleTools, listApis, providerRanks, searchPlans } from '@datacircle/lmstudio';

const [listTool, bestTool, searchTool, providerTool] = datacircleTools();
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failed++;
};
// The tool's call as .act() makes it: checkParameters, whose error's message is the result the model reads (the SDK's
// default handleInvalidToolRequest), then the implementation, whose answer .act() gives the model as JSON text.
const run = async (t, input, signal) => {
  try {
    t.checkParameters(input);
  } catch (error) {
    return { refused: error.message };
  }
  const answer = await t.implementation(input ?? {}, { signal: signal ?? new AbortController().signal, status() {}, warn() {}, callId: 1 });
  return JSON.parse(JSON.stringify(answer));
};

const NAMES = 'datacircle_list_apis,datacircle_best_plans,datacircle_search_plans,datacircle_provider';
const tools = datacircleTools();
check('names', tools.map((t) => t.name).join(',') === NAMES, tools.map((t) => t.name).join(','));
// What .act() sends the model: a raw function tool, its parameters an object with no other key, the needed keys required.
for (const t of tools) {
  const s = t.parametersJsonSchema;
  check(`${t.name} definition`, t.type === 'rawFunction' && s.type === 'object' && s.additionalProperties === false
    && s.required.every((k) => k in s.properties) && typeof t.implementation === 'function' && typeof t.checkParameters === 'function'
    && t.description.length > 50, `required [${s.required}] of [${Object.keys(s.properties)}]`);
}

let r = await run(listTool, {});
check('list_apis', r.total > 100 && r.apis.length === 20 && r.apis[0].slug, `total ${r.total}, first ${r.apis[0]?.slug}`);
r = await run(listTool, undefined);
check('list_apis no arguments at all', r.apis?.length === 20, `${r.apis?.length} APIs`);
r = await run(listTool, { query: 'email', limit: '3' });
check('list_apis email, limit as a string', r.apis?.length === 3 && r.apis.every((a) => /email/i.test(a.api + a.slug)) && !r.note, r.apis?.map((a) => a.slug).join(', '));
r = await run(listTool, { query: 'Bright Data' });
check('list_apis provider name', typeof r.note === 'string' && r.note.includes('datacircle_search_plans'), r.note);
r = await run(listTool, { query: null, limit: null });
check('list_apis nulls', r.apis?.length === 20 && !r.note, `${r.apis?.length} APIs`);

r = await run(bestTool, { slug: 'email-finder', limit: 3 });
check('best_plans', r.plans.length === 3 && r.plans[0].rank === 1 && typeof r.plans[0].score === 'number' && r.plans[0].page && !('aggregators' in r.plans[0]),
  `${r.api}: ${r.plans.map((p) => `${p.rank}. ${p.provider} ${p.score}`).join(' / ')}`);
r = await run(bestTool, { slug: 'Email Finder', limit: 99 });
check('best_plans name, limit 99', r.plans?.length >= 10 && r.slug === 'email-finder', `${r.plans?.length} plans`);
r = await run(bestTool, { slug: 'bright-data' });
check('best_plans unknown slug', r.error?.startsWith('no API has the slug bright-data') && r.error.includes('datacircle_search_plans'), r.error);
r = await run(bestTool, { slug: 'serp-api', limit: 2 });
check('best_plans slug with -api', r.slug === 'serp' && r.plans?.length === 2 && r.note?.startsWith('No API has the slug serp-api'), r.note);
r = await run(bestTool, { slug: 'Email Finder API Pricing', limit: 1 });
check('best_plans name with API pricing', r.slug === 'email-finder' && r.plans?.length === 1, r.note);
r = await run(bestTool, { slug: '<api-slug-here>' });
check('best_plans placeholder', r.error?.startsWith('"<api-slug-here>" is a placeholder'), r.error);
r = await run(bestTool, { slug: 'nope-api' });
check('best_plans unknown slug with -api', r.error?.startsWith('no API has the slug nope-api.'), r.error);
r = await run(bestTool, { slug: '' });
check('best_plans empty slug', r.error?.startsWith("Give an API's slug"), r.error);
r = await run(bestTool, { limit: 2 });
check('best_plans no slug: refused', /^Failed to parse arguments for tool "datacircle_best_plans": slug/.test(r.refused), r.refused);
r = await run(bestTool, { slug: 'serp', limit: 'many' });
check('best_plans limit not a number: refused', /: limit/.test(r.refused), r.refused);
r = await run(bestTool, { slug: 'serp', limit: 2, extra: true });
check('best_plans a key of its own: dropped', r.plans?.length === 2, `${r.plans?.length} plans`);

r = await run(searchTool, { query: 'bright data', sort: 'price', limit: 5 });
check('search_plans', r.total > 0 && r.plans.length === 5 && r.plans.every((p) => /bright data/i.test(p.provider)), `total ${r.total}, cheapest ${r.plans[0]?.perThousand}`);
r = await run(searchTool, { api: 'email-finder', limit: 2, offset: 1 });
check('search_plans api offset', r.plans.length === 2 && r.plans[0].rank === 2, r.plans.map((p) => `${p.rank}. ${p.provider}`).join(' / '));
r = await run(searchTool, { api: 'Bright Data' });
check('search_plans provider as api', r.total > 0 && r.note?.startsWith('No API is named'), `total ${r.total}: ${r.note}`);
r = await run(searchTool, { query: 'bright-data' });
check('search_plans slug as query', r.total > 0 && r.note?.includes('"bright data"'), `total ${r.total}: ${r.note}`);
r = await run(searchTool, { offset: -3, limit: 0 });
check('search_plans out of range: the defaults', r.plans?.length === 10, `${r.plans?.length} plans`);
r = await run(searchTool, { api: null, query: 'emelia', sort: null, limit: null, offset: null });
check('search_plans nulls', r.total > 0 && r.plans.every((p) => /emelia/i.test(p.provider + p.plan)), `total ${r.total}`);
r = await run(searchTool, { sort: 'cheapest' });
check('search_plans bad sort: refused', /: sort/.test(r.refused), r.refused);

r = await run(providerTool, { slug: 'Bright Data' });
check('provider', r.slug === 'bright-data' && r.total > 10 && r.ranked > 0 && r.apis[0].rank <= r.apis[1].rank && r.apis[0].best?.plan,
  `${r.provider}: ${r.total} APIs, ranked on ${r.ranked}, best ${r.apis[0].api} #${r.apis[0].rank}`);
r = await run(providerTool, { slug: '<provider-slug>' });
check('provider placeholder', r.error?.startsWith('"<provider-slug>" is a placeholder'), r.error);
r = await run(providerTool, { slug: 'nobody-x' });
check('provider unknown', r.error?.startsWith('no provider has the slug nobody-x'), r.error);
r = await run(providerTool, { slug: 'email-finder' });
check("provider: an API's slug", r.error?.startsWith('no provider has the slug email-finder') && r.error.includes('datacircle_best_plans'), r.error);

// An implementation called alone, with no check first, checks its input itself, and gives what it refuses as {error}.
r = await providerTool.implementation({});
check('an implementation alone checks its input', /^Failed to parse arguments for tool "datacircle_provider": slug/.test(r.error), r.error);
r = await bestTool.implementation({ slug: 'serp', limit: '1' });
check('an implementation alone, no context', r.plans?.length === 1, `${r.plans?.length} plan`);

// The same calls without a model.
for (const [name, call] of [['listApis', () => listApis({ limit: 1 })], ['bestPlans', () => bestPlans({ slug: 'serp', limit: 1 })],
  ['searchPlans', () => searchPlans({ limit: 1 })], ['providerRanks', () => providerRanks({ slug: 'bright-data' })]]) {
  r = await call();
  check(name, !r.error && (r.apis ?? r.plans)?.length > 0, Object.keys(r).join(','));
}
r = await bestPlans({ slug: 'nope-api' });
check('bestPlans unknown: {error}', r.error?.startsWith('no API has the slug nope-api'), r.error);

// Each call's User-Agent, through a fetch of the app's own.
const seen = [];
const [, traced] = datacircleTools({ fetch: (url, init) => (seen.push([String(url), init.headers['User-Agent']]), fetch(url, init)) });
await run(traced, { slug: 'serp', limit: 1 });
check('fetch option', seen.length === 1 && seen[0][0] === 'https://api.datacircle.dev/v1/apis/serp/best?limit=1' && seen[0][1] === 'datacircle-lmstudio/0.1.0', seen.flat().join(' '));

// The act's abort stops the call: the implementation throws, as .act() waits for once it aborted.
const controller = new AbortController();
controller.abort(new Error('stopped'));
r = await run(bestTool, { slug: 'serp' }, controller.signal).then((answer) => answer, (error) => error);
check('abort signal', r instanceof Error && /stopped|abort/i.test(r.message), String(r?.message ?? JSON.stringify(r)));

// A network that fails is the model's to read as {error}, never a throw, so the .act() goes on.
const [, down] = datacircleTools({ baseURL: 'http://127.0.0.1:9' });
r = await run(down, { slug: 'serp' });
check('network down', r.error?.startsWith('datacircle:'), r.error);

console.log(failed === 0 ? 'ALL OK' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
