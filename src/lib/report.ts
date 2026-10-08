// src/lib/report.ts
//
// Every transaction goes to Discord the same way, euros or tokens: through the
// token bot's standard report (POST /api/transactions/report, see
// opencollective/token-bot docs/api.md "Reporting a transaction"). It posts one
// message format with the category line and the steward-only dropdown, and
// never posts the same transaction (uri) twice.
//
// TX_REPORT_URL and TX_REPORT_TOKEN configure it. Without them, or when the
// report fails, the old plain message is posted instead so nothing is lost.

import { postToDiscordChannel } from "./discord.ts";

export interface TransactionReport {
  /** chb's form: stripe:txn_… (the balance transaction). */
  uri: string;
  /** In currency units (euros, not cents). */
  amount: number;
  currency: string;
  direction: "in" | "out";
  counterparty?: string;
  description?: string;
  links?: Array<{ label: string; url: string }>;
  /** A chb category slug, only when it is clear (membership, fridge, ticket, donation). */
  category?: string;
  occurredAt?: string;
  threadId?: string;
}

export interface ReportResult {
  via: "report" | "fallback" | "dryrun";
  alreadyReported?: boolean;
  messageUrl?: string;
}

const REPORT_URL = Deno.env.get("TX_REPORT_URL") ?? "https://bot.opencollective.xyz/api/transactions/report";

async function postReport(report: TransactionReport, token: string): Promise<Response> {
  return await fetch(REPORT_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(report),
  });
}

/** `fallbackMessage` null: never fall back to a plain message (the backfill must not flood the channel). */
export async function reportTransaction(report: TransactionReport, fallbackMessage: string | null): Promise<ReportResult> {
  if (Deno.env.get("ENV") === "dryrun") {
    console.log(`\nDRYRUN: would report ${JSON.stringify(report)}\n`);
    return { via: "dryrun" };
  }
  const token = Deno.env.get("TX_REPORT_TOKEN");
  if (token) {
    try {
      let res = await postReport(report, token);
      // A category the token bot does not know: report it uncategorized rather than not at all.
      if (res.status === 400 && report.category) {
        console.warn(">>> report refused category", report.category, await res.text());
        res = await postReport({ ...report, category: undefined }, token);
      }
      if (res.ok) {
        const data = await res.json();
        return { via: "report", alreadyReported: !!data.alreadyReported, messageUrl: data.messageUrl };
      }
      console.error(">>> transaction report failed", res.status, await res.text());
    } catch (e) {
      console.error(">>> transaction report failed", e);
    }
  }
  if (fallbackMessage === null) throw new Error(`could not report ${report.uri}`);
  await postToDiscordChannel(fallbackMessage);
  return { via: "fallback" };
}
