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
  --allow-net=0.0.0.0,discord.com,discord.gg,gateway.discord.gg,api.stripe.com \
  --allow-env \
  --no-prompt \
  --env-file=.env \
  src/server.ts
```

or like a cowboy:

```sh
deno run -A --env-file=.env src/server.ts
```
