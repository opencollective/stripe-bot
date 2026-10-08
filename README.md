# stripe-bot
Listening to events from Stripe and post them on Discord.


## How to install

First, make sure you have [Deno](https://docs.deno.com/runtime/getting_started/installation/) installed.

Then run

```sh
$> cp .env.example .env // then edit this file
$> deno run --env-file=.env main.ts
```

or to avoid the interactive permissions granting:


```sh
deno run \
  --allow-read=node_modules \
  --allow-net=0.0.0.0,api.opencollective.com,bot.opencollective.xyz,discord.com,*.discord.com,discord.gg,*.discord.gg,api.stripe.com \
  --allow-env \
  --no-prompt \
  --env-file=.env \
  src/server.ts
```

or like a cowboy:

```sh
deno run -A --env-file=.env src/server.ts
```


## Reporting to Discord

Payments and refunds are posted through the token bot's standard transaction report
(`POST https://bot.opencollective.xyz/api/transactions/report`, see opencollective/token-bot
`docs/api.md`), so euro and token transactions look the same on Discord and stewards can set their
category from a dropdown. Set `TX_REPORT_TOKEN` (and optionally `TX_REPORT_URL`); without it, or if the
report fails, the bot posts its plain message as before.

Missed payments (e.g. while the bot was down) can be posted afterwards into a thread, safely re-runnable:

```sh
deno run --allow-env --allow-net scripts/backfill.ts --since=2026-09-02T18:30:00Z --thread="Stripe payments 2 Sep – 8 Oct" [--dry-run] [--limit=5]
```
