/**
 * Open Collective plugin
 *
 * Requires:
 * - process.env.OPENCOLLECTIVE_GRAPHQL_API
 */

import { GraphQLClient, gql } from "npm:graphql-request";

interface Filter {
  dateFrom?: string;
  [key: string]: string | undefined;
}

interface Amount {
  value: number;
  currency: string;
}

interface Tax {
  type: string;
  rate: number;
}

interface Account {
  slug: string;
  name: string;
  description: string;
  imageUrl: string;
}

export interface Order {
  description: string;
  platformTipAmount: Amount;
  tax: Tax | null;
  hostFeePercent: number;
  totalAmount: Amount;
  createdByAccount: Account;
}

const orderInfoQuery = gql`
  query getOrderInfo($orderId: Int!) {
    order(order: { legacyId: $orderId }) {
      description
      platformTipAmount {
        value
        currency
      }
      tax {
        type
        rate
      }
      hostFeePercent
      totalAmount {
        value
        currency
      }
      createdByAccount {
        slug
        name
        description
        imageUrl
      }
    }
  }
`;

const graphqlQuery = async (query: string, variables: any) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 3000);
  try {
    const graphQLClient = new GraphQLClient(
      "https://api.opencollective.com/graphql/v2",
      {
        // @ts-ignore: GraphQLClient types don't include signal property for AbortController
        signal: controller.signal,
      }
    );
    const res = await graphQLClient.request(query, variables);
    return res;
  } catch (e) {
    console.error(">>> error", e);
  } finally {
    clearTimeout(timeoutId);
  }
};

export const getOrderInfo = async (orderId: number): Promise<Order> => {
  const res = (await graphqlQuery(orderInfoQuery, {
    orderId,
  })) as { order: Order };
  console.log(">>> getOrderInfo res", res);
  return res.order;
};
