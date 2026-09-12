export type DeletionPhase = "stripe" | "storage" | "relational";

export type DeletionStageRunner = {
  phase: DeletionPhase;
  subscriptionId: string | null;
  billingRequired?: boolean;
  cancelSubscription: ((subscriptionId: string) => Promise<void>) | null;
  listObjectPaths: () => Promise<string[]>;
  deleteObject: (objectPath: string) => Promise<void>;
  advance: (phase: DeletionPhase) => Promise<void>;
};

/**
 * The side-effect stages are kept as a small injectable runner so retries can
 * resume at the last durable phase and tests never need a real Stripe account
 * or object bucket.
 */
export async function runDeletionStages(
  input: DeletionStageRunner,
): Promise<DeletionPhase> {
  let phase = input.phase;

  if (phase === "stripe") {
    if (
      (input.billingRequired ?? Boolean(input.subscriptionId)) &&
      input.cancelSubscription
    ) {
      await input.cancelSubscription(input.subscriptionId ?? "");
    }
    phase = "storage";
    await input.advance(phase);
  }

  if (phase === "storage") {
    const paths = await input.listObjectPaths();
    for (const path of paths) {
      await input.deleteObject(path);
    }
    phase = "relational";
    await input.advance(phase);
  }

  return phase;
}