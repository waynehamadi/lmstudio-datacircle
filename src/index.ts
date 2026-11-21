// LM Studio SDK tools on Datacircle's open API: find the best GTM APIs. The API needs no key:
// https://api.datacircle.dev/v1 (its spec: https://api.datacircle.dev/v1/openapi.json). More at https://datacircle.dev

import { z } from 'zod';
import { ApiError, BASE_URL, Client, VERSION, brief, briefPlans, clamp, objects, slugify } from './client.js';
import type { Answer, DatacircleOptions } from './client.js';

export { ApiError, BASE_URL, VERSION };
export type { Answer, DatacircleOptions };

const LIST_APIS_ABOUT = "Lists the GTM APIs on Datacircle's sheet (https://datacircle.dev). GTM means go-to-market. GTM APIs are the APIs sales and marketing teams use. Gives each API's slug, how many plans and providers it has and its best plan. Call it first to find an API's slug.";
const BEST_PLANS_ABOUT = "Gives an API's plans best first by their score out of 100 on Datacircle's benchmark (https://datacircle.dev), each with its rank, provider, plan, $ per 1,000 calls and its page. perThousand is a plan's price of 1,000 items in dollars, pay the plan's whole price in its currency.";
const SEARCH_PLANS_ABOUT = "Searches every plan on Datacircle's sheet (https://datacircle.dev), or one API's, by provider or plan name, sorted by score, provider or price. Gives how many were found and up to limit of them. perThousand is a plan's price of 1,000 items in dollars, pay the plan's whole price in its currency.";
const PROVIDER_ABOUT = "Gives each API one provider sells and its rank on each on Datacircle's benchmark (https://datacircle.dev), with its best plan there, its best rank first. total is how many APIs it sells, ranked on how many of them it has a rank. For an API's best providers, call datacircle_best_plans.";

// Tells a model that sent a provider's name to an API's tool where a provider's plans are.
const FOR_PROVIDER = "A provider's plans: datacircle_search_plans with its name as query, like bright data, or datacircle_provider.";

// Tells a model that sent an API's slug to the provider's tool where an API's best providers are.
const FOR_API = "An API's best providers: datacircle_best_plans with the API's slug, like email-finder.";

// Each input's schema, what the model is sent, and its check, what the tool's checkParameters runs on the model's input. The
// check is looser than the schema, so that a small local model that strays is understood where it can be: null is a key left out, a key of its own is dropped, a number sent as a string is read as one, a
// fraction cut to its whole part, a limit or an offset below 1 takes its default. What it refuses, the model reads why.
type Field = { json: Record<string, unknown>; zod: z.ZodType; needed?: true };
const count = (low: number, high: number | null, description: string): Field => ({
  json: { type: 'integer', minimum: low, ...(high === null ? {} : { maximum: high }), description },
  zod: z.coerce.number().nullable().optional(),
});
const text = (description: string): Field => ({ json: { type: 'string', description }, zod: z.string().nullable().optional() });
const needed = (description: string): Field => ({ json: { type: 'string', description }, zod: z.string(), needed: true });
const choice = (values: [string, ...string[]], description: string): Field => ({
  json: { type: 'string', enum: values, description },
  zod: z.enum(values).nullable().optional(),
});

type Input = { json: DatacircleSchema; zod: z.ZodType };
function input(fields: Record<string, Field>): Input {
  const keys = Object.keys(fields);
  return {
    json: {
      type: 'object',
      properties: Object.fromEntries(keys.map((key) => [key, fields[key].json])),
      required: keys.filter((key) => fields[key].needed),
      additionalProperties: false,
    },
    zod: z.object(Object.fromEntries(keys.map((key) => [key, fields[key].zod]))),
  };
}

const listApisInput = input({
  query: text("Words of the API's name or slug, like email or linkedin profile: the APIs that hold the most of them come first. Left out, the sheet's order"),
  limit: count(1, 200, 'How many APIs to give, 1 to 200. 20 when left out: the sheet has about 150'),
});

const bestPlansInput = input({
  slug: needed("The API's slug, like email-finder or linkedin-profile, as datacircle_list_apis gives it"),
  limit: count(1, 50, 'How many plans to give, 1 to 50. 10 when left out'),
});

const searchPlansInput = input({
  api: text("Only this API's plans: its name or slug, like email-finder. A provider's name goes in query, never here. Left out, every API"),
  query: text("Words that must all appear in the provider's or plan's name, like bright data. Left out, every plan"),
  sort: choice(['score', 'provider', 'price'], 'score (best first, the default), provider (A to Z) or price ($ per 1,000, lowest first)'),
  limit: count(1, 50, 'How many plans to give, 1 to 50. 10 when left out'),
  offset: count(0, null, 'How many found plans to skip first. 0 when left out'),
});

const providerInput = input({
  slug: needed("The provider's slug, like bright-data, or its name, like Bright Data: the name is made a slug"),
});

/** datacircle_list_apis' input. */
export type ListApisInput = { query?: string | null; limit?: number | null };
/** datacircle_best_plans' input. */
export type BestPlansInput = { slug: string; limit?: number | null };
/** datacircle_search_plans' input. */
export type SearchPlansInput = { api?: string | null; query?: string | null; sort?: 'score' | 'provider' | 'price' | null; limit?: number | null; offset?: number | null };
/** datacircle_provider's input. */
export type ProviderInput = { slug: string };

/** A limit the model sent, within the API's bounds, or undefined for the API's default. */
const bounded = (n: number | null | undefined, high: number) => (n === undefined || n === null || !(n >= 1) ? undefined : clamp(n, 1, high));

/** An answer of 4xx (an unknown slug, a wrong argument) is the call's answer as {error}, the API's words. */
function asResult(error: unknown): Answer {
  if (error instanceof ApiError) return { error: error.message };
  throw error;
}

async function listApisRun(client: Client, { query, limit }: ListApisInput, signal?: AbortSignal): Promise<Answer> {
  let apis: Answer[];
  try {
    apis = objects(await client.get<unknown>('/apis', {}, signal));
  } catch (error) {
    return asResult(error);
  }
  const words = (query ?? '').toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  const found = apis
    .map((api, order) => {
      const name = `${String(api.api ?? '')} ${String(api.slug ?? '').replace(/-/g, ' ')}`.toLowerCase();
      return { order, matched: words.filter((word) => name.includes(word)).length, api };
    })
    .filter(({ matched }) => matched > 0 || words.length === 0)
    // The most words matched first, the sheet's order within each.
    .sort((a, b) => b.matched - a.matched || a.order - b.order);
  const answer: Answer = {
    total: found.length,
    apis: found.slice(0, bounded(limit, 200) ?? 20)
      .map(({ api }) => brief(api, ['api', 'slug', 'plans', 'providers', 'best', 'bestPage', 'sheetPage'])),
  };
  if (words.length > 0 && (found.length === 0 || found[0].matched < words.length)) {
    // A provider's name sent as an API's, like Bright Data, whose data matches many APIs: where its plans are.
    answer.note = `No API's name holds every word of ${JSON.stringify(query)}. A provider's plans: datacircle_search_plans with its name as query, or datacircle_provider.`;
  }
  return answer;
}

/** A placeholder a small model copies from a prompt's example, like <api-slug>, sent in place of a slug. */
const PLACEHOLDER = /[<>{}]/;

async function bestPlansRun(client: Client, { slug, limit }: BestPlansInput, signal?: AbortSignal): Promise<Answer> {
  if (PLACEHOLDER.test(slug ?? '')) {
    return { error: `${JSON.stringify(slug)} is a placeholder. Give the API's own slug, like email-finder: datacircle_list_apis gives every slug.` };
  }
  const api = slugify(slug ?? '');
  if (api === '') return { error: `Give an API's slug, like email-finder: datacircle_list_apis gives every slug. ${FOR_PROVIDER}` };
  const best = async (api: string) => {
    const answer = await client.get(`/apis/${api}/best`, { limit: bounded(limit, 50) }, signal);
    return { ...answer, plans: briefPlans(answer.plans) };
  };
  try {
    return await best(api);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      // The slug with "api" after it, like serp-api, as the sheet's address reads (/serp-api-pricing): the API's own.
      const bare = api.replace(/-api(-pricing)?$/, '');
      if (bare !== api && bare !== '') {
        try {
          return { ...(await best(bare)), note: `No API has the slug ${api}: these are ${bare}'s plans.` };
        } catch {
          // The first answer stands.
        }
      }
      // A provider's name sent as the API's slug: the API's words, and where a provider's plans are.
      return { error: `${error.message}. datacircle_list_apis gives every API's slug. ${FOR_PROVIDER}` };
    }
    return asResult(error);
  }
}

async function searchPlansRun(client: Client, input: SearchPlansInput, signal?: AbortSignal): Promise<Answer> {
  const search = (api: string, query: string) =>
    client.get('/plans', {
      api: api.trim(),
      query: query.trim(),
      sort: input.sort ?? undefined,
      limit: bounded(input.limit, 50),
      offset: input.offset === undefined || input.offset === null || !(input.offset > 0) ? undefined : Math.trunc(input.offset),
    }, signal);
  let api = input.api ?? '';
  let query = input.query ?? '';
  const notes: string[] = [];
  try {
    let answer: Answer;
    try {
      answer = await search(api, query);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 400 && error.message.includes('api must be') && query.trim() === '')) throw error;
      // A provider's name sent as the API: the plans whose provider or plan name holds it.
      [api, query] = ['', api];
      answer = await search(api, query);
      notes.push(`No API is named ${JSON.stringify(input.api)}: these are the plans whose provider or plan name holds it.`);
    }
    if (answer.total === 0 && query.includes('-')) {
      // A slug sent as a name, like bright-data, which no name holds: its words, like bright data. A name with a
      // hyphen, like A-Leads, is found as it is first.
      const words = query.replace(/-/g, ' ').split(/\s+/).filter(Boolean).join(' ');
      try {
        answer = await search(api, words);
        notes.push(`No provider's or plan's name holds ${JSON.stringify(query)}: these are the plans whose name holds ${JSON.stringify(words)}.`);
      } catch {
        // The first answer stands.
      }
    }
    return { ...answer, plans: briefPlans(answer.plans), ...(notes.length > 0 ? { note: notes.join(' ') } : {}) };
  } catch (error) {
    return asResult(error);
  }
}

async function providerRun(client: Client, { slug }: ProviderInput, signal?: AbortSignal): Promise<Answer> {
  if (PLACEHOLDER.test(slug ?? '')) {
    return { error: `${JSON.stringify(slug)} is a placeholder. Give the provider's own slug or name, like bright-data or Bright Data.` };
  }
  const provider = slugify(slug ?? '');
  if (provider === '') return { error: "Give a provider's slug or name, like bright-data or Bright Data" };
  let answer: Answer;
  try {
    answer = await client.get(`/providers/${provider}`, {}, signal);
  } catch (error) {
    // An API's slug sent as a provider's, like email-finder: the API's words, and where an API's best providers are.
    if (error instanceof ApiError && error.status === 404) return { error: `${error.message}. ${FOR_API}` };
    return asResult(error);
  }
  const apis = objects(answer.apis).map((entry) => {
    const plans = objects(entry.plans);
    const kept: Answer = { ...brief(entry, ['api', 'slug', 'rank', 'bestPage']), plans: plans.length };
    const best = bestPlan(plans);
    if (best) kept.best = brief(best, ['plan', 'score', 'perThousand', 'page']);
    return kept;
  });
  // Its best rank first, the APIs where it has none last, in the API's order.
  const rank = (api: Answer) => (typeof api.rank === 'number' ? api.rank : Infinity);
  apis.sort((a, b) => rank(a) - rank(b));
  return { ...answer, apis, total: apis.length, ranked: apis.filter((api) => typeof api.rank === 'number').length };
}

/** A provider's best plan on an API: its lowest rank, the first when none has a rank. */
function bestPlan(plans: Answer[]): Answer | undefined {
  const ranked = plans.filter((plan) => typeof plan.rank === 'number');
  if (ranked.length === 0) return plans[0];
  return ranked.reduce((best, plan) => ((plan.rank as number) < (best.rank as number) ? plan : best));
}

/** Why the check refused the model's input: each refused key and why, in the words the SDK's own tools use. */
function refused(name: string, error: z.ZodError): string {
  const words = error.issues.map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message));
  return `Failed to parse arguments for tool "${name}": ${words.join('; ')}`;
}

/** A tool's parameters as the model is sent them: an object, its needed keys required, no other key. */
export type DatacircleSchema = {
  [key: string]: unknown;
  type: 'object';
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: false;
};

/** The four tools' names, in their order. Their answers name each other by these names. */
export type ToolName = 'datacircle_list_apis' | 'datacircle_best_plans' | 'datacircle_search_plans' | 'datacircle_provider';

/** What a tool's implementation reads of the context .act() passes it: its signal, which stops the call. */
export interface DatacircleToolContext {
  signal?: AbortSignal | null;
}

/**
 * A tool for model.act(chat, tools) and a plugin's tools provider: a raw function tool (its parameters a JSON schema), as
 * the SDK's rawFunctionTool makes it, on @lmstudio/sdk 1.2.0 and later. What .act() sends the model of it is its name,
 * description and parameters. An input checkParameters refuses, the model reads why. The implementation's answer is an
 * object, which the model reads as JSON: an answer of 4xx (an unknown slug) or a failed network is {error}, never a
 * throw, as a throw stops the whole .act().
 */
export interface DatacircleTool<Name extends ToolName = ToolName> {
  type: 'rawFunction';
  name: Name;
  description: string;
  parametersJsonSchema: DatacircleSchema;
  /** The model's input checked: an input that does not fit throws, and the model reads why. */
  checkParameters: (params: unknown) => void;
  /** Calls the API. The .act()'s abort stops the call. */
  implementation: (params: Record<string, unknown>, ctx?: DatacircleToolContext) => Promise<Answer>;
}

function tool<In, Name extends ToolName>(
  client: Client,
  name: Name,
  description: string,
  schema: Input,
  call: (client: Client, input: In, signal?: AbortSignal) => Promise<Answer>,
): DatacircleTool<Name> {
  const check = (params: unknown): Record<string, unknown> => {
    const parsed = schema.zod.safeParse(params ?? {});
    if (!parsed.success) throw new Error(refused(name, parsed.error));
    return parsed.data as Record<string, unknown>;
  };
  return {
    type: 'rawFunction',
    name,
    description,
    parametersJsonSchema: structuredClone(schema.json),
    checkParameters: (params) => {
      check(params);
    },
    implementation: async (params, ctx) => {
      // .act() checks before it calls. Called alone, the implementation checks its input itself, and what it refuses is
      // its answer, as .act() gives it.
      let input: Record<string, unknown>;
      try {
        input = check(params);
      } catch (error) {
        return { error: (error as Error).message };
      }
      const signal = ctx?.signal ?? undefined;
      try {
        return await call(client, input as In, signal);
      } catch (error) {
        // The .act() stopped: its own abort, as it waits for. Else a failed network, which the model reads and may call
        // again, the .act() going on.
        if (signal?.aborted) throw error;
        return { error: (error as Error).message };
      }
    },
  };
}

/**
 * The four tools, for model.act(chat, datacircleTools()): datacircle_list_apis (GET /apis), datacircle_best_plans
 * (GET /apis/{slug}/best), datacircle_search_plans (GET /plans) and datacircle_provider (GET /providers/{slug}).
 */
export function datacircleTools(options?: DatacircleOptions): DatacircleTool[] {
  const client = new Client(options);
  return [
    tool<ListApisInput, 'datacircle_list_apis'>(client, 'datacircle_list_apis', LIST_APIS_ABOUT, listApisInput, listApisRun),
    tool<BestPlansInput, 'datacircle_best_plans'>(client, 'datacircle_best_plans', BEST_PLANS_ABOUT, bestPlansInput, bestPlansRun),
    tool<SearchPlansInput, 'datacircle_search_plans'>(client, 'datacircle_search_plans', SEARCH_PLANS_ABOUT, searchPlansInput, searchPlansRun),
    tool<ProviderInput, 'datacircle_provider'>(client, 'datacircle_provider', PROVIDER_ABOUT, providerInput, providerRun),
  ];
}

// The same calls without a model: each gives the answer the model would read, as an object, an answer of 4xx as {error}.

/** GET /apis: the APIs, as datacircle_list_apis gives them. */
export const listApis = (input: ListApisInput = {}, options?: DatacircleOptions) => listApisRun(new Client(options), input);

/** GET /apis/{slug}/best: an API's plans best first, as datacircle_best_plans gives them. */
export const bestPlans = (input: BestPlansInput, options?: DatacircleOptions) => bestPlansRun(new Client(options), input);

/** GET /plans: the plans found, as datacircle_search_plans gives them. */
export const searchPlans = (input: SearchPlansInput = {}, options?: DatacircleOptions) => searchPlansRun(new Client(options), input);

/** GET /providers/{slug}: where a provider ranks, as datacircle_provider gives it. */
export const providerRanks = (input: ProviderInput, options?: DatacircleOptions) => providerRun(new Client(options), input);
