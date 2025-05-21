import { assertEquals } from "https://deno.land/std/assert/mod.ts";
import { handler, summarizeStripeEvent } from "../src/server.ts";

const mockStripeSignature = "t=1234567890,v1=test_signature";

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

// Note: The following tests would require mocking the Stripe signature verification
// and Discord webhook posting. They are commented out as they would need additional setup.

Deno.test("handler processes charge.succeeded event", async () => {
  const res = await summarizeStripeEvent(mockChargeSucceededEvent);
  assertEquals(
    res,
    "Received $20.00 (including $2.00 Luma application fee) from John Doe (Test charge) (💳 visa) [[View Receipt](<https://receipt.stripe.com/test>)]"
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
