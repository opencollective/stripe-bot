// deno-lint-ignore-file no-explicit-any
/**
 * Post the Stripe payments Discord missed (the bot was down from 2026-09-02 to
 * 2026-10-08) through the token bot's standard report, in a thread of the
 * transactions channel, oldest first. Safe to re-run: the token bot never
 * posts the same transaction twice.
 *
 * Run where the bot's env is (its container):
 *   deno run --allow-env --allow-net scripts/backfill.ts --since=2026-09-02T18:30:00Z --thread="Stripe payments 2 Sep – 8 Oct" [--dry-run] [--limit=5]
 * A thread id instead of a name posts into an existing thread: --thread-id=…
 */
import { describeStripeEvent, getCheckoutSessionMetadata, stripe, toReport } from "../src/server.ts";
import { reportTransaction } from "../src/lib/report.ts";

const arg = (name: string) => Deno.args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const since = Math.floor(Date.parse(arg("since") ?? "") / 1000);
if (!Number.isFinite(since)) throw new Error("--since=ISO date is required");
const until = arg("until") ? Math.floor(Date.parse(arg("until")!) / 1000) : undefined;
const dryRun = Deno.args.includes("--dry-run");
const limit = Number(arg("limit") ?? Infinity);

const charges: any[] = [];
for await (const ch of stripe.charges.list({ created: { gt: since, ...(until ? { lt: until } : {}) }, limit: 100 })) {
  if (ch.status === "succeeded" && ch.paid) charges.push(ch);
}
charges.sort((a, b) => a.created - b.created);
console.log(`${charges.length} succeeded charges since ${new Date(since * 1000).toISOString()}`);

let threadId = arg("thread-id");
if (!threadId && !dryRun) {
  const name = arg("thread") ?? "Stripe payments";
  const res = await fetch(`https://discord.com/api/v10/channels/${Deno.env.get("DISCORD_CHANNEL_ID")}/threads`, {
    method: "POST",
    headers: { authorization: `Bot ${Deno.env.get("DISCORD_BOT_TOKEN")}`, "content-type": "application/json" },
    body: JSON.stringify({ name, type: 11, auto_archive_duration: 10080 }),
  });
  if (!res.ok) throw new Error(`could not create the thread: ${res.status} ${await res.text()}`);
  threadId = (await res.json()).id;
  console.log(`thread "${name}": ${threadId}`);
}

let posted = 0, already = 0, skipped = 0;
for (const ch of charges.slice(0, limit)) {
  const sessions = ch.payment_intent ? await stripe.checkout.sessions.list({ payment_intent: ch.payment_intent, limit: 1 }) : { data: [] };
  const meta = sessions.data[0] ? getCheckoutSessionMetadata(sessions.data[0]) : null;
  const t = await describeStripeEvent({ type: "charge.succeeded", data: { object: ch } }, meta);
  const report = t && toReport(t);
  if (!report) {
    skipped++;
    console.warn(`skip ${ch.id}: no balance transaction`);
    continue;
  }
  if (dryRun) {
    console.log(JSON.stringify(report));
    continue;
  }
  const result = await reportTransaction({ ...report, threadId }, null);
  if (result.alreadyReported) already++;
  else posted++;
  console.log(`${result.alreadyReported ? "already" : "posted"} ${report.uri} €${report.amount} ${report.category ?? ""}`);
  await new Promise((r) => setTimeout(r, 1200));
}
console.log(`done: ${posted} posted, ${already} already reported, ${skipped} skipped`);
