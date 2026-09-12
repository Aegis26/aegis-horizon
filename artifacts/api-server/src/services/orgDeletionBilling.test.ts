import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelOrganizationBilling,
  OrganizationBillingMismatchError,
  type OrganizationBillingRow,
  type OrganizationBillingStripeClient,
} from "./orgDeletionBilling";

type FakeSubscription = {
  id: string;
  customer: string;
  status: string;
  metadata: { orgId: string };
};

type FakeCheckoutSession = {
  id: string;
  customer: string;
  status: "open" | "complete" | "expired";
  metadata: { orgId: string };
  subscription?: string | null;
};

function organization(
  overrides: Partial<OrganizationBillingRow> = {},
): OrganizationBillingRow {
  return {
    id: "org_target",
    stripeCustomerId: "cus_target",
    stripeSubscriptionId: null,
    ...overrides,
  };
}

function fakeStripe(input: {
  subscriptions?: FakeSubscription[];
  sessions?: FakeCheckoutSession[];
  customerMetadata?: { orgId: string };
  completeOnExpireSubscriptionId?: string;
  cannotExpire?: boolean;
}) {
  const subscriptions = [...(input.subscriptions ?? [])];
  const sessions = [...(input.sessions ?? [])];
  const events: string[] = [];
  const calls = {
    subscriptionLists: [] as Record<string, unknown>[],
    subscriptionRetrieves: [] as string[],
    subscriptionCancels: [] as string[],
    sessionLists: [] as Record<string, unknown>[],
    sessionExpires: [] as string[],
  };

  const stripe = {
    customers: {
      retrieve: async (id: string) => ({
        id,
        metadata: input.customerMetadata ?? { orgId: "org_target" },
      }),
    },
    subscriptions: {
      list: async (params: Record<string, unknown>) => {
        events.push("subscriptions.list");
        calls.subscriptionLists.push(params);
        return { data: subscriptions, has_more: false };
      },
      retrieve: async (id: string) => {
        events.push(`subscriptions.retrieve:${id}`);
        calls.subscriptionRetrieves.push(id);
        const subscription = subscriptions.find((item) => item.id === id);
        if (!subscription) {
          throw Object.assign(new Error("missing"), {
            code: "resource_missing",
          });
        }
        return subscription;
      },
      cancel: async (id: string) => {
        events.push(`subscriptions.cancel:${id}`);
        calls.subscriptionCancels.push(id);
        const subscription = subscriptions.find((item) => item.id === id);
        if (!subscription) {
          throw Object.assign(new Error("missing"), {
            code: "resource_missing",
          });
        }
        subscription.status = "canceled";
        return subscription;
      },
    },
    checkout: {
      sessions: {
        list: async (params: Record<string, unknown>) => {
          events.push("sessions.list");
          calls.sessionLists.push(params);
          return { data: sessions, has_more: false };
        },
        retrieve: async (id: string) => {
          events.push(`sessions.retrieve:${id}`);
          const session = sessions.find((item) => item.id === id);
          if (!session) {
            throw Object.assign(new Error("missing"), {
              code: "resource_missing",
            });
          }
          return session;
        },
        expire: async (id: string) => {
          events.push(`sessions.expire:${id}`);
          calls.sessionExpires.push(id);
          const session = sessions.find((item) => item.id === id);
          if (!session || session.status !== "open") {
            throw Object.assign(new Error("session is no longer open"), {
              code: "invalid_request_error",
            });
          }
          if (input.cannotExpire) {
            throw Object.assign(new Error("cannot expire this session"), {
              code: "invalid_request_error",
            });
          }
          if (input.completeOnExpireSubscriptionId) {
            session.status = "complete";
            session.subscription = input.completeOnExpireSubscriptionId;
            subscriptions.push({
              id: input.completeOnExpireSubscriptionId,
              customer: "cus_target",
              status: "active",
              metadata: { orgId: "org_target" },
            });
            throw Object.assign(
              new Error("Checkout Session status is complete"),
              {
                code: "invalid_request_error",
              },
            );
          }
          session.status = "expired";
          return session;
        },
      },
    },
  } as unknown as OrganizationBillingStripeClient;

  return { stripe, calls, events };
}

test("lists all subscriptions when the stored subscription ID is empty", async () => {
  const { stripe, calls } = fakeStripe({
    subscriptions: [
      {
        id: "sub_monthly",
        customer: "cus_target",
        status: "active",
        metadata: { orgId: "org_target" },
      },
      {
        id: "sub_trial",
        customer: "cus_target",
        status: "trialing",
        metadata: { orgId: "org_target" },
      },
      {
        id: "sub_already_canceled",
        customer: "cus_target",
        status: "canceled",
        metadata: { orgId: "org_target" },
      },
    ],
    sessions: [
      {
        id: "cs_open",
        customer: "cus_target",
        status: "open",
        metadata: { orgId: "org_target" },
      },
    ],
  });

  await cancelOrganizationBilling(organization(), stripe);

  assert.deepEqual(calls.subscriptionLists, [
    { customer: "cus_target", status: "all", limit: 100 },
    { customer: "cus_target", status: "all", limit: 100 },
  ]);
  assert.deepEqual(calls.subscriptionRetrieves, []);
  assert.deepEqual(calls.subscriptionCancels, ["sub_monthly", "sub_trial"]);
  assert.deepEqual(calls.sessionLists, [
    { customer: "cus_target", status: "open", limit: 100 },
    { customer: "cus_target", status: "open", limit: 100 },
  ]);
  assert.deepEqual(calls.sessionExpires, ["cs_open"]);
});

test("rejects a foreign checkout session before cancelling any billing", async () => {
  const { stripe, calls } = fakeStripe({
    subscriptions: [
      {
        id: "sub_target",
        customer: "cus_target",
        status: "active",
        metadata: { orgId: "org_target" },
      },
    ],
    sessions: [
      {
        id: "cs_foreign",
        customer: "cus_target",
        status: "open",
        // Checkout metadata must be checked directly; subscription_data
        // metadata is not a substitute for this value.
        metadata: { orgId: "org_other" },
      },
    ],
  });

  await assert.rejects(
    cancelOrganizationBilling(organization(), stripe),
    (error: unknown) =>
      error instanceof OrganizationBillingMismatchError &&
      error.resource === "checkout_session" &&
      error.resourceId === "cs_foreign",
  );
  assert.deepEqual(calls.subscriptionCancels, []);
  assert.deepEqual(calls.sessionExpires, []);
});

test("rejects a customer whose metadata is bound to another organization", async () => {
  const { stripe, calls } = fakeStripe({
    customerMetadata: { orgId: "org_other" },
    subscriptions: [
      {
        id: "sub_foreign",
        customer: "cus_target",
        status: "active",
        metadata: { orgId: "org_target" },
      },
    ],
  });

  await assert.rejects(
    cancelOrganizationBilling(organization(), stripe),
    (error: unknown) =>
      error instanceof OrganizationBillingMismatchError &&
      error.resource === "customer",
  );
  assert.deepEqual(calls.subscriptionLists, []);
  assert.deepEqual(calls.subscriptionCancels, []);
});

test("is idempotent when retried after subscriptions are canceled and sessions expire", async () => {
  const { stripe, calls } = fakeStripe({
    subscriptions: [
      {
        id: "sub_target",
        customer: "cus_target",
        status: "active",
        metadata: { orgId: "org_target" },
      },
    ],
    sessions: [
      {
        id: "cs_target",
        customer: "cus_target",
        status: "open",
        metadata: { orgId: "org_target" },
      },
    ],
  });

  await cancelOrganizationBilling(organization(), stripe);
  await cancelOrganizationBilling(organization(), stripe);

  assert.deepEqual(calls.subscriptionCancels, ["sub_target"]);
  assert.deepEqual(calls.sessionExpires, ["cs_target"]);
});

test("reconciles a subscription created when an open checkout completes during expiry", async () => {
  const { stripe, calls, events } = fakeStripe({
    completeOnExpireSubscriptionId: "sub_created_by_checkout",
    sessions: [
      {
        id: "cs_raced",
        customer: "cus_target",
        status: "open",
        metadata: { orgId: "org_target" },
      },
    ],
  });

  await cancelOrganizationBilling(organization(), stripe);

  assert.deepEqual(calls.subscriptionCancels, ["sub_created_by_checkout"]);
  assert.deepEqual(calls.subscriptionRetrieves, [
    "sub_created_by_checkout",
  ]);
  assert.deepEqual(calls.sessionExpires, ["cs_raced"]);
  assert.ok(
    events.indexOf("sessions.expire:cs_raced") <
      events.indexOf("subscriptions.list"),
  );
  assert.ok(
    events.indexOf("sessions.retrieve:cs_raced") <
      events.indexOf("subscriptions.cancel:sub_created_by_checkout"),
  );
});

test("does not treat a generic checkout expire error as successful expiry", async () => {
  const { stripe, calls } = fakeStripe({
    cannotExpire: true,
    sessions: [
      {
        id: "cs_error",
        customer: "cus_target",
        status: "open",
        metadata: { orgId: "org_target" },
      },
    ],
  });

  await assert.rejects(
    cancelOrganizationBilling(organization(), stripe),
    /cannot expire this session/,
  );
  assert.deepEqual(calls.subscriptionLists, []);
  assert.deepEqual(calls.sessionExpires, ["cs_error"]);
});

test("does not cancel a stored subscription unless its customer and metadata are verified", async () => {
  const { stripe, calls } = fakeStripe({
    subscriptions: [
      {
        id: "sub_stored",
        customer: "cus_other",
        status: "active",
        metadata: { orgId: "org_target" },
      },
    ],
  });

  await assert.rejects(
    cancelOrganizationBilling(
      organization({ stripeSubscriptionId: "sub_stored" }),
      stripe,
    ),
    (error: unknown) =>
      error instanceof OrganizationBillingMismatchError &&
      error.resource === "subscription",
  );
  assert.deepEqual(calls.subscriptionCancels, []);
  assert.deepEqual(calls.sessionExpires, []);
});