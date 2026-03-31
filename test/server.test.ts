import { assertEquals } from "@std/assert";
import {
  handler,
  summarizeStripeEvent,
  bufferEvent,
  eventBuffer,
} from "../src/server.ts";

const mockChargeSucceededEvent = {
  type: "charge.succeeded",
  data: {
    object: {
      amount: 2000, // $20.00
      currency: "usd",
      description: "Test charge",
      statement_descriptor: "TEST CHARGE",
      billing_details: {
        name: "John Doe",
      },
      payment_method_details: {
        type: "card",
        card: {
          brand: "visa",
        },
      },
      application: "ca_HB0JKrk4R6zGWt4fAD9M6iutRhuBdFqd", // Luma
      receipt_url: "https://receipt.stripe.com/test",
      application_fee: 200, // $2.00
    },
  },
};

const mockChargeRefundedEvent = {
  type: "charge.refunded",
  data: {
    object: {
      amount_refunded: 2000, // $20.00
      currency: "usd",
      description: "Test refund",
      statement_descriptor: "TEST REFUND",
      billing_details: {
        name: "John Doe",
      },
      receipt_url: "https://receipt.stripe.com/test",
    },
  },
};

Deno.test("handler returns 404 for invalid path", async () => {
  const req = new Request("http://localhost:3000/invalid");
  const res = await handler(req);
  assertEquals(res.status, 404);
});

Deno.test("handler returns 405 for non-POST method", async () => {
  const req = new Request("http://localhost:3000/webhook/stripe", {
    method: "GET",
  });
  const res = await handler(req);
  assertEquals(res.status, 405);
});

Deno.test("handler returns 400 for missing signature", async () => {
  const req = new Request("http://localhost:3000/webhook/stripe", {
    method: "POST",
    body: JSON.stringify(mockChargeSucceededEvent),
  });
  const res = await handler(req);
  assertEquals(res.status, 400);
});

Deno.test("handler processes charge.succeeded event", async () => {
  const res = await summarizeStripeEvent(mockChargeSucceededEvent);
  assertEquals(
    res,
    "💳 Received $20.00 (including $2.00 Luma application fee) from John Doe (🎟️ Ticket for Test charge) [[View Receipt](<https://receipt.stripe.com/test>)]"
  );
  console.log(">>> res", res);
});

Deno.test("handler processes charge.refunded event", async () => {
  const res = await summarizeStripeEvent(mockChargeRefundedEvent);
  console.log(">>> res", res);
  assertEquals(
    res,
    "Refunded $20.00 to John Doe (Test refund) [[View Receipt](<https://receipt.stripe.com/test>)]"
  );
});

Deno.test("summarize with checkout session metadata (collective + custom fields)", async () => {
  const sessionMeta = {
    collective: "Brussels Together",
    customFieldsTable:
      "\n| Field | Value |\n|---|---|\n| Company | Acme Corp |\n| Dietary | Vegan |",
  };
  const res = await summarizeStripeEvent(mockChargeSucceededEvent, sessionMeta);
  console.log(">>> res with session meta", res);
  // Should contain collective name
  assertEquals(res.includes("for **Brussels Together**"), true);
  // Should contain custom fields table
  assertEquals(res.includes("| Company | Acme Corp |"), true);
  assertEquals(res.includes("| Dietary | Vegan |"), true);
});

Deno.test("bufferEvent buffers charge when no checkout session yet", () => {
  const chargeEvent = {
    type: "charge.succeeded",
    id: "evt_test_buffer1",
    data: {
      object: {
        payment_intent: "pi_test_buffer1",
        amount: 1000,
        currency: "usd",
      },
    },
  };
  const result = bufferEvent(chargeEvent);
  assertEquals(result, "buffered");
  const entry = eventBuffer.get("pi_test_buffer1");
  assertEquals(entry?.chargeEvent, chargeEvent);
  assertEquals(entry?.checkoutSession, undefined);
  // Clean up
  if (entry?.timerId) clearTimeout(entry.timerId);
  eventBuffer.delete("pi_test_buffer1");
});

Deno.test("bufferEvent returns null when no payment_intent", () => {
  const chargeEvent = {
    type: "charge.succeeded",
    id: "evt_test_nopi",
    data: { object: { amount: 1000, currency: "usd" } },
  };
  const result = bufferEvent(chargeEvent);
  assertEquals(result, null);
});

Deno.test({
  name: "bufferEvent processes immediately when both events arrive",
  sanitizeOps: false,
  sanitizeResources: false,
  fn() {
  const piId = "pi_test_both";
  const chargeEvent = {
    type: "charge.succeeded",
    id: "evt_test_both_charge",
    data: {
      object: {
        payment_intent: piId,
        amount: 1000,
        currency: "usd",
        description: "Test",
        billing_details: { name: "Test User" },
        receipt_url: "https://receipt.stripe.com/test",
      },
    },
  };
  const checkoutEvent = {
    type: "checkout.session.completed",
    id: "evt_test_both_checkout",
    data: {
      object: {
        payment_intent: piId,
        metadata: { collective: "Test Collective" },
        custom_fields: [
          { label: { custom: "Company" }, text: { value: "Acme" } },
        ],
      },
    },
  };

  // First event gets buffered
  const r1 = bufferEvent(chargeEvent);
  assertEquals(r1, "buffered");

  // Second event triggers immediate processing
  const r2 = bufferEvent(checkoutEvent);
  assertEquals(r2, "processed");
  },
});
