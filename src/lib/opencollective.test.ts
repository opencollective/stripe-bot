import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getOrderInfo, Order } from "./opencollective.ts";

Deno.test(
  "getOrderInfo should return correct order data for order 837122",
  async () => {
    const orderId = 837122;
    const expectedResult: Order = {
      description:
        "Monthly financial contribution to Commons Hub Brussels (Shifter)",
      platformTipAmount: {
        value: 0,
        currency: "EUR",
      },
      tax: null,
      hostFeePercent: 0,
      totalAmount: {
        value: 121,
        currency: "EUR",
      },
      createdByAccount: {
        slug: "cedric-sounard",
        name: "Cedric",
        description:
          "Event Communication Software startup, we make it quick and easy so you focus on your mission!",
        imageUrl: "https://images.opencollective.com/cedric-sounard/avatar.png",
      },
    };

    const result = await getOrderInfo(orderId);
    assertEquals(result, expectedResult);
  }
);
