// deno-lint-ignore-file no-explicit-any
import { postToDiscordChannel } from "./lib/discord.ts";
import { createHmac } from "node:crypto";
import Stripe from "npm:stripe";
import { getOrderInfo } from "./lib/opencollective.ts";
const stripeSecret = Deno.env.get("STRIPE_SECRET");
if (!stripeSecret) {
  throw new Error("STRIPE_SECRET is not set in the environment");
}
const stripe = new Stripe(stripeSecret);

const PORT = Number(Deno.env.get("PORT") ?? 3000);

let eventsProcessed: number = 0;
const startTimestamp: number = Date.now();

const eventTypes = ["charge.succeeded", "charge.refunded"];
const ignoreEvents = ["evt_3RZSkmFAhaWeDyow2nUtzMTL"];
const STRIPE_SIGNING_SECRET = Deno.env.get("STRIPE_SIGNING_SECRET");

const getApplicationName = (application_id: string) => {
  const apps: Record<string, string> = {
    ca_HB0JKrk4R6zGWt4fAD9M6iutRhuBdFqd: "Luma",
    ca_68FQ4jN0XMVhxpnk6gAptwvx90S9VYXF: "Open Collective",
  };
  return apps[application_id] || "Stripe";
};

const getPaymentMethod = (payment_method_details: any) => {
  if (payment_method_details.type === "card") {
    return payment_method_details["card"]["brand"];
  }
  return payment_method_details.type;
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

export async function summarizeStripeEvent(event: any): Promise<string> {
  const ch = event.data.object;
  if (event.type === "charge.refunded") {
    const description = ch.description || ch.statement_descriptor;
    const description_string = description ? ` (${description})` : "";
    return `Refunded ${formatAmount(ch.amount_refunded, ch.currency)} to ${
      ch.billing_details?.name || "unknown"
    }${description_string} [[View Receipt](<${ch.receipt_url}>)]`;
  }
  if (event.type === "charge.succeeded") {
    let description = ch.description || ch.statement_descriptor;
    let from = "unknown";
    const customer = await stripe.customers.retrieve(ch.customer);
    if (!customer.deleted && customer.name) {
      from = customer.name;
    }

    if (!customer.deleted && customer.metadata?.discord_userid) {
      from = `<@${customer.metadata.discord_userid}>`;
    }

    let invoiceId = ch.invoice;
    if (!invoiceId && ch.payment_intent) {
      console.log(">>> fetching ch.payment_intent", ch.payment_intent);
      const paymentIntent = await stripe.paymentIntents.retrieve(
        ch.payment_intent
      );
      console.log(">>> paymentIntent", paymentIntent);
      if ("invoice" in paymentIntent) {
        invoiceId = paymentIntent.invoice as string;
      }
      console.log(">>> invoiceId", invoiceId);
    }

    if (invoiceId) {
      try {
        console.log(">>> fetching invoice", invoiceId);
        const invoice = await stripe.invoices.retrieve(invoiceId);
        description = invoice.lines.data
          .map((line: Stripe.InvoiceLineItem) => {
            return line.description;
          })
          .join(" \n");
      } catch (e) {
        console.error("Error getting invoice", invoiceId, e);
      }
    }
    if (getApplicationName(ch.application) === "Open Collective") {
      const orderInfo = await getOrderInfo(Number(ch.metadata.orderId));
      description = orderInfo.description;
      from = `[${orderInfo.createdByAccount.name}](<https://opencollective.com/${orderInfo.createdByAccount.slug}>)`;
    }

    const description_string = description ? ` (${description})` : "";

    const applicationFee = ch.application_fee
      ? ` (including ${formatAmount(
          ch.application_fee,
          ch.currency
        )} ${getApplicationName(ch.application)} application fee)`
      : "";
    return `💳 Received ${formatAmount(
      ch.amount,
      ch.currency
    )}${applicationFee} from ${from}${description_string} [[View Receipt](<${
      ch.receipt_url
    }>)]`;
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
  const summary = await summarizeStripeEvent(event);
  if (ignoreEvents.includes(event.id)) {
    console.log(">>> ignoring event", event.id);
    console.log(">>> dry run discord message:", summary);
    return new Response("ok");
  }
  await postToDiscordChannel(summary);
  eventsProcessed++;
  return new Response("ok");
};

Deno.serve({ port: PORT }, handler);

console.log(
  `Listening for Stripe webhooks on http://localhost:${PORT}/webhook/stripe`
);
