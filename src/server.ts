// deno-lint-ignore-file no-explicit-any
import { postToDiscordChannel } from "./lib/discord.ts";
import { createHmac } from "node:crypto";
import Stripe from "stripe";
import { getOrderInfo } from "./lib/opencollective.ts";
const stripeSecret = Deno.env.get("STRIPE_SECRET");
if (!stripeSecret) {
  throw new Error("STRIPE_SECRET is not set in the environment");
}
const stripe = new Stripe(stripeSecret);

const PORT = Number(Deno.env.get("PORT") ?? 3000);

let eventsProcessed: number = 0;
const startTimestamp: number = Date.now();

const eventTypes = [
  "charge.succeeded",
  "charge.refunded",
  "checkout.session.completed",
];
const ignoreEvents = ["evt_3RZSkmFAhaWeDyow2nUtzMTL"];
const STRIPE_SIGNING_SECRET = Deno.env.get("STRIPE_SIGNING_SECRET");

// Event buffer: holds events keyed by payment_intent for up to BUFFER_TIMEOUT_MS
// so that checkout.session.completed metadata can enrich the charge.succeeded message
const BUFFER_TIMEOUT_MS = 60_000;

interface BufferedEntry {
  chargeEvent?: any;
  checkoutSession?: any;
  timerId?: ReturnType<typeof setTimeout>;
}

export const eventBuffer = new Map<string, BufferedEntry>();

function getPaymentIntentId(event: any): string | null {
  if (event.type === "charge.succeeded" || event.type === "charge.refunded") {
    return event.data.object.payment_intent || null;
  }
  if (event.type === "checkout.session.completed") {
    return event.data.object.payment_intent || null;
  }
  return null;
}

function formatCustomFields(session: any): string {
  const fields = session.custom_fields;
  if (!fields || fields.length === 0) return "";
  const rows = fields
    .map((f: any) => {
      const label = f.label?.custom || f.label?.value || f.key;
      const value =
        f.text?.value || f.dropdown?.value || f.numeric?.value || "";
      return `| ${label} | ${value} |`;
    })
    .join("\n");
  return `\n| Field | Value |\n|---|---|\n${rows}`;
}

function getCheckoutSessionMetadata(session: any): {
  collective?: string;
  customFieldsTable: string;
} {
  const metadata = session.metadata || {};
  return {
    collective: metadata.collective || undefined,
    customFieldsTable: formatCustomFields(session),
  };
}

async function processBufferedEntry(
  paymentIntentId: string,
  entry: BufferedEntry
) {
  eventBuffer.delete(paymentIntentId);

  // If we only have a checkout session and no charge, nothing to post
  if (!entry.chargeEvent) {
    console.log(
      ">>> checkout.session.completed received without matching charge, skipping",
      paymentIntentId
    );
    return;
  }

  const sessionMeta = entry.checkoutSession
    ? getCheckoutSessionMetadata(entry.checkoutSession)
    : null;

  const summary = await summarizeStripeEvent(entry.chargeEvent, sessionMeta);

  if (ignoreEvents.includes(entry.chargeEvent.id)) {
    console.log(">>> ignoring event", entry.chargeEvent.id);
    console.log(">>> dry run discord message:", summary);
    return;
  }

  await postToDiscordChannel(summary);
  eventsProcessed++;
}

export function bufferEvent(event: any) {
  const piId = getPaymentIntentId(event);
  if (!piId) {
    // No payment intent — can't buffer, process immediately
    return null;
  }

  const existing = eventBuffer.get(piId) || {};

  if (event.type === "charge.succeeded") {
    existing.chargeEvent = event;
  } else if (event.type === "checkout.session.completed") {
    existing.checkoutSession = event.data.object;
  }

  // If we have both events, process immediately
  if (existing.chargeEvent && existing.checkoutSession) {
    if (existing.timerId) clearTimeout(existing.timerId);
    eventBuffer.set(piId, existing);
    processBufferedEntry(piId, existing);
    return "processed";
  }

  // Otherwise, start/keep timeout
  if (!existing.timerId) {
    existing.timerId = setTimeout(() => {
      const entry = eventBuffer.get(piId);
      if (entry) {
        processBufferedEntry(piId, entry);
      }
    }, BUFFER_TIMEOUT_MS);
  }

  eventBuffer.set(piId, existing);
  return "buffered";
}

const getApplicationName = (application_id: string) => {
  const apps: Record<string, string> = {
    ca_HB0JKrk4R6zGWt4fAD9M6iutRhuBdFqd: "Luma",
    ca_68FQ4jN0XMVhxpnk6gAptwvx90S9VYXF: "Open Collective",
  };
  return apps[application_id] || "Stripe";
};

const currencySymbols = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  CAD: "$",
  AUD: "$",
};

function formatAmount(amount: number, currency: string): string {
  return `${
    currencySymbols[currency.toUpperCase() as keyof typeof currencySymbols]
  }${(amount / 100).toFixed(2)}`;
}

export async function summarizeStripeEvent(
  event: any,
  sessionMeta?: { collective?: string; customFieldsTable: string } | null
): Promise<string> {
  const ch = event.data.object;
  if (event.type === "charge.refunded") {
    const description = ch.description || ch.statement_descriptor;
    const description_string = description ? ` (${description})` : "";
    return `Refunded ${formatAmount(ch.amount_refunded, ch.currency)} to ${
      ch.billing_details?.name || "unknown"
    }${description_string} [[View Receipt](<${ch.receipt_url}>)]`;
  }
  if (event.type === "charge.succeeded") {
    let description =
      ch.statement_descriptor ||
      ch.calculated_statement_descriptor ||
      ch.description;

    let from = "unknown";

    if (ch.customer) {
      const customer = await stripe.customers.retrieve(ch.customer);
      if (!customer.deleted && customer.name) {
        from = customer.name;
      }
      if (!customer.deleted && customer.metadata?.discord_userid) {
        from = `<@${customer.metadata.discord_userid}>`;
      }
    } else if (ch.billing_details?.name) {
      from = ch.billing_details.name;
    }

    if (!ch.invoice && ch.payment_intent) {
      console.log(">>> fetching ch.payment_intent", ch.payment_intent);
      const paymentIntent = await stripe.paymentIntents.retrieve(
        ch.payment_intent,
        { expand: ["invoice"] }
      );
      console.log(">>> paymentIntent", paymentIntent);
      if ("invoice" in paymentIntent) {
        const invoice = paymentIntent.invoice as Stripe.Invoice;
        description = invoice.lines.data
          .map((line: Stripe.InvoiceLineItem) => {
            return line.description;
          })
          .join(" \n");
      }
    } else if (ch.invoice) {
      try {
        console.log(">>> fetching invoice", ch.invoice);
        const invoice = await stripe.invoices.retrieve(ch.invoice);
        description = invoice.lines.data
          .map((line: Stripe.InvoiceLineItem) => {
            return line.description;
          })
          .join(" \n");
      } catch (e) {
        console.error("Error getting invoice", ch.invoice, e);
      }
    }

    if (getApplicationName(ch.application) === "Open Collective") {
      const orderInfo = await getOrderInfo(Number(ch.metadata.orderId));
      description = orderInfo.description;
      from = `[${orderInfo.createdByAccount.name}](<https://opencollective.com/${orderInfo.createdByAccount.slug}>)`;
    }

    if (getApplicationName(ch.application) === "Luma") {
      description = `🎟️ Ticket for ${ch.description}`;
    }

    // Enrich with checkout session metadata (collective, custom fields)
    const collective = sessionMeta?.collective;
    const collectiveStr = collective ? ` for **${collective}**` : "";

    const description_string = description ? ` (${description})` : "";

    const applicationFee = ch.application_fee
      ? ` (including ${formatAmount(
          ch.application_fee,
          ch.currency
        )} ${getApplicationName(ch.application)} application fee)`
      : "";

    let message = `💳 Received ${formatAmount(
      ch.amount,
      ch.currency
    )}${applicationFee} from ${from}${collectiveStr}${description_string} [[View Receipt](<${
      ch.receipt_url
    }>)]`;

    if (sessionMeta?.customFieldsTable) {
      message += sessionMeta.customFieldsTable;
    }

    return message;
  }
  return `Received Stripe event: ${event.type}`;
}

export const handler = async (req: Request) => {
  const url = new URL(req.url);

  if (url.pathname === "/" && req.method === "GET") {
    return new Response(
      `<html>
        <body>
          Server listening on port ${PORT} since ${new Date(
        startTimestamp
      ).toISOString()}<br />
          Connected to Discord Channel Id: ${Deno.env.get(
            "DISCORD_CHANNEL_ID"
          )}<br />Number of events processed: ${eventsProcessed}
        </body>
      </html>`,
      {
        status: 200,
        headers: {
          "Content-Type": "text/html",
        },
      }
    );
  }
  if (url.pathname !== "/webhook/stripe") {
    return new Response("Not Found", { status: 404 });
  }

  if (req.method !== "POST") {
    return new Response("Only POST allowed", { status: 405 });
  }

  // Get the Stripe signature from the headers
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("No Stripe signature found", { status: 400 });
  }

  // Get the raw body as text
  const body = await req.text();

  // Verify the signature
  if (STRIPE_SIGNING_SECRET) {
    try {
      const timestamp = signature.split(",")[0].split("=")[1];
      const signedPayload = `${timestamp}.${body}`;
      const expectedSignature = createHmac("sha256", STRIPE_SIGNING_SECRET)
        .update(signedPayload)
        .digest("hex");

      const receivedSignature = signature.split(",")[1].split("=")[1];
      if (receivedSignature !== expectedSignature) {
        return new Response("Invalid signature", { status: 400 });
      }
    } catch (e) {
      console.error("Error verifying signature:", e);
      return new Response("Error verifying signature", { status: 400 });
    }
  }

  let event;
  try {
    event = JSON.parse(body);
  } catch (e) {
    console.error("Invalid JSON", e);
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!eventTypes.includes(event.type)) {
    return new Response(`Event ${event.type} not supported`, { status: 200 });
  }

  // Refunds don't need buffering — process immediately
  if (event.type === "charge.refunded") {
    const summary = await summarizeStripeEvent(event);
    if (ignoreEvents.includes(event.id)) {
      console.log(">>> ignoring event", event.id);
      console.log(">>> dry run discord message:", summary);
      return new Response("ok");
    }
    await postToDiscordChannel(summary);
    eventsProcessed++;
    return new Response("ok");
  }

  // Buffer charge.succeeded and checkout.session.completed events
  // to merge metadata before posting to Discord
  const result = bufferEvent(event);
  if (result === null) {
    // No payment_intent — can't buffer, process immediately
    const summary = await summarizeStripeEvent(event);
    if (ignoreEvents.includes(event.id)) {
      console.log(">>> ignoring event", event.id);
      console.log(">>> dry run discord message:", summary);
      return new Response("ok");
    }
    await postToDiscordChannel(summary);
    eventsProcessed++;
  }
  return new Response("ok");
};

Deno.serve({ port: PORT }, handler);

console.log(
  `Listening for Stripe webhooks on http://localhost:${PORT}/webhook/stripe`
);

console.log(">>> Using Discord channel", Deno.env.get("DISCORD_CHANNEL_ID"));
