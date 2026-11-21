# Datacircle tools for the LM Studio SDK

Find the best GTM APIs. We benchmark all the GTM APIs and we put the results on our website.

Our website: https://datacircle.dev

This package gives the [LM Studio SDK](https://github.com/lmstudio-ai/lmstudio-js) four tools that call Datacircle's open API, https://api.datacircle.dev/v1. They run in `model.act()` with the model you have loaded in LM Studio. You need no key and no account.

| Tool | What the tool gives | Call |
| --- | --- | --- |
| `datacircle_list_apis` | Every GTM API on Datacircle, with the API's slug, number of plans, number of providers and best plan | `GET /apis` |
| `datacircle_best_plans` | One API's plans, sorted by score out of 100, best first. Each plan comes with a rank and a price per 1,000 calls | `GET /apis/{slug}/best` |
| `datacircle_search_plans` | Plans that match a provider or plan name, on all APIs or on one API. You can sort them by score, provider or price | `GET /plans` |
| `datacircle_provider` | The APIs a provider sells, and the provider's rank on each API | `GET /providers/{slug}` |

## Install

```bash
npm install @datacircle/lmstudio @lmstudio/sdk
```

The tools work with `@lmstudio/sdk` 1.2.0 and later. The package works from ESM and from CommonJS. LM Studio or its headless daemon must be running, with a model that can call tools.

## Use the tools

Give the tools to `model.act()`:

```ts
import { LMStudioClient } from '@lmstudio/sdk';
import { datacircleTools } from '@datacircle/lmstudio';

const client = new LMStudioClient();
const model = await client.llm.model();

await model.act('Who are the 3 best providers for the email-finder API?', datacircleTools(), {
  onMessage: (message) => console.info(message.toString()),
});
```

The tools can sit beside your own tools in the same list, made with `tool()` or `rawFunctionTool()`: `[...datacircleTools(), myTool]`. To give the model only some of the tools, filter them by name: `datacircleTools().filter((t) => t.name !== 'datacircle_provider')`.

## Make each call yourself

You can also make each call without a model. You get the answer the model would read, as an object:

```ts
import { bestPlans } from '@datacircle/lmstudio';

const answer = await bestPlans({ slug: 'email-finder', limit: 3 });
console.log(answer.plans);
```

The other calls are `listApis()`, `searchPlans()` and `providerRanks()`.

## What the model reads

Each tool gives the model a JSON object. Each plan comes with a rank, provider, plan, score, price per 1,000 (`perThousand`, in dollars) and a page on datacircle.dev. That page lists every field.

When the API gives no data, for example for an unknown slug, the model reads `{"error": ...}` with the API's message. When the input does not fit the schema, the model reads which argument is wrong. If the network fails, the model gets the error's message the same way. The model can then call again, and `act()` goes on. When you stop `act()` with its `signal`, the call stops too.

`datacircleTools({ fetch })` sets the `fetch` the tools use, for example to add a proxy or a timeout. Each call without a model takes the same options as its second argument.

## Network

Each tool call makes one HTTPS GET request to https://api.datacircle.dev/v1, or two when a slug needs a second try, and nothing else. The request holds only the tool's own arguments: no key and nothing from your chats. The API takes up to 60 calls a minute from one IP address. The tool waits once, for a minute at most, when the API asks the tool to wait. The package depends only on zod, and stores nothing.

## Links

- Datacircle: https://datacircle.dev
- The API: https://datacircle.dev/api
- The API's spec: https://api.datacircle.dev/v1/openapi.json
- What each key means: https://datacircle.dev/fields

MIT license.
