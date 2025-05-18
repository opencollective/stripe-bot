// deno-lint-ignore-file no-explicit-any
import { postToDiscordChannel } from "./lib/discord.ts";

const PORT = Number(Deno.env.get("PORT") ?? 3000);

let eventsProcessed: number = 0;
let startTimestamp: number = Date.now();

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

function summarizeStripeEvent(event: any): string {
  console.log("summarizeStripeEvent Stripe event:", event);
  if (event.type === "charge.succeeded") {
    const ch = event.data.object;

    const description = ch.description || ch.statement_descriptor;
    const description_string = description ? ` (${description})` : "";

    const applicationFee = ch.application_fee
      ? ` (including ${
          ch.application_fee / 100
        } ${ch.currency.toUpperCase()} application fee)`
      : "";
    return `Received ${
      ch.amount / 100
    } ${ch.currency.toUpperCase()}${applicationFee} from ${
      ch.billing_details?.name || "unknown"
    }${description_string} [[View Receipt](<${
      ch.receipt_url
    }>)] (using ${getPaymentMethod(
      ch.payment_method_details
    )} via ${getApplicationName(ch.application)})`;
  }
  return `Received Stripe event: ${event.type}`;
}

const handler = async (req: Request) => {
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
  const body = await req.text();
  let event;
  try {
    event = JSON.parse(body);
  } catch (e) {
    console.error("Invalid JSON", e);
    return new Response("Invalid JSON", { status: 400 });
  }
  if (event.type !== "charge.succeeded") {
    return new Response("Not a charge.succeeded event", { status: 200 });
  }
  const summary = summarizeStripeEvent(event);
  await postToDiscordChannel(summary);
  eventsProcessed++;
  return new Response("ok");
};

Deno.serve({ port: PORT }, handler);

console.log(
  `Listening for Stripe webhooks on http://localhost:${PORT}/webhook/stripe`
);
