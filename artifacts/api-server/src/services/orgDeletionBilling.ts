import Stripe from "stripe";

/**
 * Keep this input deliberately small.  Organization deletion only needs the
 * identifiers that bind a Stripe customer and its subscriptions to the row
 * being deleted.
 */
export type OrganizationBillingRow = {
  id: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
};

type StripeListPage<T extends { id: string }> = {
  data: T[];
  has_more?: boolean;
};

type SubscriptionListParams = {
  customer: string;
  status: "all";
  limit: number;
  starting_after?: string;
};

type CheckoutSessionListParams = {
  customer: string;
  status: "open";
  limit: number;
  starting_after?: string;
};

/**
 * The injectable shape is useful for tests, while the default implementation
 * remains the application's uncached Stripe client.  The production caller
 * only needs to pass the organization row.
 */
export type OrganizationBillingStripeClient = {
  customers: {
    retrieve(id: string): Promise<unknown>;
  };
  subscriptions: {
    list(
      params: SubscriptionListParams,
    ): Promise<StripeListPage<Stripe.Subscription>>;
    retrieve(id: string): Promise<Stripe.Subscription>;
    cancel(id: string): Promise<Stripe.Subscription>;
  };
  checkout: {
    sessions: {
      list(
        params: CheckoutSessionListParams,
      ): Promise<StripeListPage<Stripe.Checkout.Session>>;
      retrieve(id: string): Promise<Stripe.Checkout.Session>;
      expire(id: string): Promise<Stripe.Checkout.Session>;
    };
  };
};

export type OrganizationBillingMismatchResource =
  | "customer"
  | "subscription"
  | "checkout_session";

/**
 * A mismatch is a safety failure, not a "best effort" cleanup condition.  In
 * particular, do not cancel resources found under a customer until every
 * resource has been checked against the organization binding.
 */
export class OrganizationBillingMismatchError extends Error {
  constructor(
    public readonly resource: OrganizationBillingMismatchResource,
    public readonly resourceId: string,
    message: string,
  ) {
    super(message);
    this.name = "OrganizationBillingMismatchError";
  }
}

function metadataOrgId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const metadata = (value as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  const orgId = (metadata as Record<string, unknown>).orgId;
  return typeof orgId === "string" ? orgId : undefined;
}

function customerIdOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const customer = (value as { customer?: unknown }).customer;
  if (typeof customer === "string") return customer;
  if (customer && typeof customer === "object") {
    const id = (customer as { id?: unknown }).id;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

function isResourceMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    statusCode?: unknown;
    status?: unknown;
  };
  return (
    candidate.code === "resource_missing" ||
    candidate.statusCode === 404 ||
    candidate.status === 404
  );
}

type CompletedCheckoutSessionError = "complete" | "expired" | null;

function checkoutSessionErrorOutcome(
  error: unknown,
): CompletedCheckoutSessionError {
  if (isResourceMissing(error)) return "expired";
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  if (code === "checkout_session_completed") return "complete";
  if (code === "checkout_session_expired") return "expired";
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return null;
  if (
    /already\s+(?:expired|complete)|(?:status|session).*(?:expired|complete)|(?:expired|complete).*(?:status|session)|completed/i.test(
      message,
    )
  ) {
    return /expired/i.test(message) ? "expired" : "complete";
  }
  // A generic "cannot expire" error is not proof that the session completed
  // (and must not be swallowed as if it were a successful expiry).
  return null;
}

function isAlreadyCanceledSubscription(error: unknown): boolean {
  if (isResourceMissing(error)) return true;
  if (!error || typeof error !== "object") return false;
  const message = (error as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    /already\s+cancell?ed|subscription.*cancell?ed/i.test(message)
  );
}

async function listAll<T extends { id: string }>(
  fetchPage: (
    params: Record<string, unknown>,
  ) => Promise<StripeListPage<T>>,
  params: Record<string, unknown>,
): Promise<T[]> {
  const result: T[] = [];
  let startingAfter: string | undefined;

  while (true) {
    const page = await fetchPage({
      ...params,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    result.push(...page.data);

    if (!page.has_more || page.data.length === 0) return result;
    startingAfter = page.data[page.data.length - 1].id;
  }
}

function requireBinding(
  resource: OrganizationBillingMismatchResource,
  resourceId: string,
  actual: boolean,
  message: string,
): void {
  if (!actual) {
    throw new OrganizationBillingMismatchError(resource, resourceId, message);
  }
}

function shouldCancelSubscription(subscription: Stripe.Subscription): boolean {
  // `incomplete_expired` is terminal just like `canceled`; all other Stripe
  // subscription statuses still represent a subscription that can bill or
  // resume billing and therefore need cancellation.
  return (
    subscription.status !== "canceled" &&
    subscription.status !== "incomplete_expired"
  );
}

const MAX_CONVERGENCE_PASSES = 3;

export class OrganizationBillingConvergenceError extends Error {
  constructor() {
    super(
      "Stripe billing did not converge after expiring checkout sessions and canceling subscriptions",
    );
    this.name = "OrganizationBillingConvergenceError";
  }
}

function subscriptionIdOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const subscription = (value as { subscription?: unknown }).subscription;
  if (typeof subscription === "string") return subscription;
  if (subscription && typeof subscription === "object") {
    const id = (subscription as { id?: unknown }).id;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

function validateCheckoutSession(
  organization: OrganizationBillingRow,
  customerId: string,
  session: Stripe.Checkout.Session,
): void {
  requireBinding(
    "checkout_session",
    session.id,
    customerIdOf(session) === customerId,
    `Stripe Checkout Session ${session.id} belongs to a different customer`,
  );
  // This deliberately reads the Checkout Session's own metadata.  The
  // subscription_data metadata is not authoritative while a session is still
  // open and can differ from the actual session metadata.
  requireBinding(
    "checkout_session",
    session.id,
    metadataOrgId(session) === organization.id,
    `Stripe Checkout Session ${session.id} is not bound to organization ${organization.id}`,
  );
}

async function listOpenCheckoutSessions(
  stripe: OrganizationBillingStripeClient,
  customerId: string,
): Promise<Stripe.Checkout.Session[]> {
  const sessions = await listAll(
    (params) =>
      stripe.checkout.sessions.list(
        params as unknown as CheckoutSessionListParams,
      ),
    { customer: customerId, status: "open", limit: 100 },
  );
  // Stripe honors status=open, but filtering the response makes a test or
  // eventual-consistency response harmless instead of expiring a settled
  // session.
  return sessions.filter((session) => session.status === "open");
}

async function listFreshSubscriptions(
  organization: OrganizationBillingRow,
  stripe: OrganizationBillingStripeClient,
  customerId: string,
): Promise<Stripe.Subscription[]> {
  const [listed, stored] = await Promise.all([
    listAll(
      (params) =>
        stripe.subscriptions.list(
          params as unknown as SubscriptionListParams,
        ),
      { customer: customerId, status: "all", limit: 100 },
    ),
    organization.stripeSubscriptionId
      ? stripe.subscriptions
          .retrieve(organization.stripeSubscriptionId)
          .catch((error: unknown) => {
            if (isResourceMissing(error)) return null;
            throw error;
          })
      : Promise.resolve(null),
  ]);

  const byId = new Map<string, Stripe.Subscription>();
  for (const subscription of listed) byId.set(subscription.id, subscription);
  if (stored) byId.set(stored.id, stored);
  return [...byId.values()];
}

function validateSubscriptions(
  organization: OrganizationBillingRow,
  customerId: string,
  subscriptions: Stripe.Subscription[],
): void {
  for (const subscription of subscriptions) {
    requireBinding(
      "subscription",
      subscription.id,
      customerIdOf(subscription) === customerId,
      `Stripe subscription ${subscription.id} belongs to a different customer`,
    );
    requireBinding(
      "subscription",
      subscription.id,
      metadataOrgId(subscription) === organization.id,
      `Stripe subscription ${subscription.id} is not bound to organization ${organization.id}`,
    );
  }
}

/**
 * Expire a snapshot of open sessions before looking at subscriptions.  If a
 * Checkout Session completes during the expire request, retrieving the
 * completed session and then its subscription closes the race where the
 * subscription is created after the original subscription list.
 */
async function expireOpenCheckoutSessions(
  organization: OrganizationBillingRow,
  stripe: OrganizationBillingStripeClient,
  customerId: string,
  sessions: Stripe.Checkout.Session[],
): Promise<Stripe.Subscription[]> {
  const completedSubscriptions: Stripe.Subscription[] = [];

  for (const listedSession of sessions) {
    validateCheckoutSession(organization, customerId, listedSession);

    let completedSession: Stripe.Checkout.Session | null = null;
    try {
      const result = await stripe.checkout.sessions.expire(listedSession.id);
      if (result.status === "complete") {
        completedSession = await stripe.checkout.sessions.retrieve(listedSession.id);
      } else if (result.status === "expired") {
        continue;
      } else {
        // An expire call that reports an open session is not a successful
        // cleanup and must not be silently accepted.
        throw new Error(
          `Stripe Checkout Session ${listedSession.id} remained open after expire`,
        );
      }
    } catch (error) {
      const outcome = checkoutSessionErrorOutcome(error);
      if (!outcome) throw error;
      if (outcome === "expired") continue;
      completedSession = await stripe.checkout.sessions
        .retrieve(listedSession.id)
        .catch((retrieveError: unknown) => {
          if (isResourceMissing(retrieveError)) return null;
          throw retrieveError;
        });
    }

    if (!completedSession) continue;
    validateCheckoutSession(organization, customerId, completedSession);
    const subscriptionId = subscriptionIdOf(completedSession);
    if (!subscriptionId) continue;

    const subscription = await stripe.subscriptions
      .retrieve(subscriptionId)
      .catch((error: unknown) => {
        if (isResourceMissing(error)) return null;
        throw error;
      });
    if (subscription) completedSubscriptions.push(subscription);
  }

  return completedSubscriptions;
}

/**
 * Cancels every verified subscription and expires every verified open
 * Checkout Session for an organization.
 *
 * The customer is retrieved first because an organization-held customer ID is
 * not, by itself, proof that the customer belongs to this organization.
 * Every listed resource is then checked before any mutation occurs.  This
 * prevents a malformed or foreign Stripe response from causing a partial
 * destructive cleanup.
 *
 * The optional client argument is a test seam.  It is intentionally not
 * needed by production callers, which use the existing uncached client.
 */
export async function cancelOrganizationBilling(
  organization: OrganizationBillingRow,
  stripeClient?: OrganizationBillingStripeClient,
): Promise<void> {
  const customerId = organization.stripeCustomerId;

  if (!customerId) {
    if (organization.stripeSubscriptionId) {
      throw new OrganizationBillingMismatchError(
        "customer",
        organization.stripeSubscriptionId,
        "Cannot verify a stored subscription without its Stripe customer",
      );
    }
    // There is no customer to scope a Stripe query to and no known
    // subscription.  This is the safe, idempotent no-billing case.
    return;
  }

  const stripe = stripeClient
    ? stripeClient
    : ((await import("../lib/stripeClient")).getUncachableStripeClient() as unknown as OrganizationBillingStripeClient);

  let customer: unknown;
  try {
    customer = await stripe.customers.retrieve(customerId);
  } catch (error) {
    // A deleted/missing customer has no remaining billable resources.  Do not
    // guess at another customer or attempt an unscoped search.
    if (isResourceMissing(error)) return;
    throw error;
  }

  if (
    customer &&
    typeof customer === "object" &&
    (customer as { deleted?: unknown }).deleted === true
  ) {
    return;
  }
  requireBinding(
    "customer",
    customerId,
    metadataOrgId(customer) === organization.id,
    `Stripe customer ${customerId} is not exclusively bound to organization ${organization.id}`,
  );

  for (let pass = 0; pass < MAX_CONVERGENCE_PASSES; pass += 1) {
    // Checkout sessions are drained before subscriptions are enumerated.
    // Completing a session can create a subscription, so the subscription
    // snapshot must always be taken after this step.
    const openCheckoutSessions = await listOpenCheckoutSessions(
      stripe,
      customerId,
    );
    for (const session of openCheckoutSessions) {
      validateCheckoutSession(organization, customerId, session);
    }

    const completedSubscriptions = await expireOpenCheckoutSessions(
      organization,
      stripe,
      customerId,
      openCheckoutSessions,
    );
    const subscriptions = await listFreshSubscriptions(
      organization,
      stripe,
      customerId,
    );
    const subscriptionsById = new Map<string, Stripe.Subscription>();
    for (const subscription of subscriptions) {
      subscriptionsById.set(subscription.id, subscription);
    }
    for (const subscription of completedSubscriptions) {
      subscriptionsById.set(subscription.id, subscription);
    }
    const verifiedSubscriptions = [...subscriptionsById.values()];
    validateSubscriptions(organization, customerId, verifiedSubscriptions);

    for (const subscription of verifiedSubscriptions) {
      if (!shouldCancelSubscription(subscription)) continue;
      try {
        await stripe.subscriptions.cancel(subscription.id);
      } catch (error) {
        // Stripe cancellation is safe to retry.  A concurrent retry may make
        // a subscription disappear between the list and cancel calls.
        if (!isAlreadyCanceledSubscription(error)) throw error;
      }
    }

    // Re-enumerate both resources after mutation.  If a session completed
    // while the first snapshot was being drained, the next pass expires any
    // remaining open sessions before taking another subscription snapshot.
    const remainingOpenSessions = await listOpenCheckoutSessions(
      stripe,
      customerId,
    );
    for (const session of remainingOpenSessions) {
      validateCheckoutSession(organization, customerId, session);
    }
    const remainingSubscriptions = await listFreshSubscriptions(
      organization,
      stripe,
      customerId,
    );
    validateSubscriptions(
      organization,
      customerId,
      remainingSubscriptions,
    );

    if (
      remainingOpenSessions.length === 0 &&
      remainingSubscriptions.every(
        (subscription) => !shouldCancelSubscription(subscription),
      )
    ) {
      return;
    }
  }

  throw new OrganizationBillingConvergenceError();
}