import { createLead } from "@workspace/api-client-react";
import type { Lead, LeadCreate } from "@workspace/api-client-react";

const DATABASE_NAME = "aegis-horizon-offline";
const DATABASE_VERSION = 1;
const STORE_NAME = "lead-mutations";
const CHANGE_EVENT = "aegis:lead-queue-change";

export interface QueuedLead {
  id: string;
  idempotencyKey: string;
  orgId: string;
  /**
   * Offline mutations are authored by a Clerk account. Keep that scope with
   * the record so an account switch cannot display or sync another user's
   * unsynced lead.
   */
  clerkUserId?: string;
  data: LeadCreate;
  createdAt: string;
  lastError?: string;
}

export interface LeadQueueChange {
  syncedLead?: Lead;
  orgId?: string;
  clerkUserId?: string;
}

export interface LeadSyncAuth {
  /**
   * This callback is evaluated for every queued request. The caller supplies
   * a token for the Clerk identity that owns the queue record.
   */
  getToken: () => Promise<string | null>;
  /**
   * Reads the live Clerk identity, rather than the identity captured when a
   * sync job started.
   */
  getCurrentUserId: () => string | null;
}

export interface LeadQueueSyncDependencies {
  list: (clerkUserId: string) => Promise<QueuedLead[]>;
  create: (record: QueuedLead, authToken: string) => Promise<Lead>;
  remove: (record: QueuedLead) => Promise<void>;
  update: (record: QueuedLead) => Promise<void>;
  notify?: (detail: LeadQueueChange) => void;
}

const syncPromises = new Map<string, Promise<void>>();

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        const store = request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
        store.createIndex("orgId", "orgId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the offline queue."));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Offline queue operation failed."));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error ?? new Error("Offline queue transaction failed."));
  });
}

function notify(detail: LeadQueueChange = {}): void {
  window.dispatchEvent(new CustomEvent<LeadQueueChange>(CHANGE_EVENT, { detail }));
}

function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function listQueuedLeads(
  orgId?: string,
  clerkUserId?: string,
): Promise<QueuedLead[]> {
  const records = await withStore<QueuedLead[]>("readonly", (store) => store.getAll());
  return records
    // Records written before account scoping was added remain in IndexedDB,
    // but are deliberately not exposed to an authenticated account because
    // their owner cannot be established safely.
    .filter(
      (record) =>
        (!orgId || record.orgId === orgId) &&
        (!clerkUserId || record.clerkUserId === clerkUserId),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function enqueueLead(
  orgId: string,
  data: LeadCreate,
  clerkUserId: string,
  auth: LeadSyncAuth,
): Promise<QueuedLead> {
  const key = newIdempotencyKey();
  const record: QueuedLead = {
    id: `pending-${key}`,
    idempotencyKey: key,
    orgId,
    clerkUserId,
    data,
    createdAt: new Date().toISOString(),
  };
  await withStore<IDBValidKey>("readwrite", (store) => store.add(record));
  notify({ orgId, clerkUserId });
  void syncLeadQueue(clerkUserId, auth);
  return record;
}

async function updateQueuedLead(record: QueuedLead): Promise<void> {
  await withStore<IDBValidKey>("readwrite", (store) => store.put(record));
}

async function deleteQueuedLead(id: string): Promise<void> {
  await withStore<undefined>("readwrite", (store) => store.delete(id));
}

export function createLeadRequestOptions(
  record: QueuedLead,
  authToken: string,
): RequestInit {
  return {
    // The explicit Clerk token is identity-bound. Omitting cookies prevents a
    // newly signed-in account from taking precedence over the queue owner.
    credentials: "omit",
    headers: {
      Authorization: `Bearer ${authToken}`,
      "Idempotency-Key": record.idempotencyKey,
    },
  };
}

function tokenSubject(authToken: string): string | null {
  const payloadSegment = authToken.split(".")[1];
  if (!payloadSegment) return null;
  try {
    const base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { sub?: unknown };
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

const defaultSyncDependencies: LeadQueueSyncDependencies = {
  list: (clerkUserId) => listQueuedLeads(undefined, clerkUserId),
  create: (record, authToken) =>
    createLead(
      record.orgId,
      record.data,
      createLeadRequestOptions(record, authToken),
    ),
  remove: (record) => deleteQueuedLead(record.id),
  update: updateQueuedLead,
  notify,
};

/**
 * Runs one identity-bound queue. It intentionally leaves records in
 * IndexedDB when the Clerk identity changes or a token cannot be obtained.
 * The request itself uses an explicit bearer token with cookies omitted, so a
 * session switch cannot turn an A-owned mutation into a B-owned mutation.
 */
export async function syncLeadQueueForUser(
  clerkUserId: string,
  auth: LeadSyncAuth,
  dependencies: LeadQueueSyncDependencies = defaultSyncDependencies,
): Promise<void> {
  dependencies.notify?.({ clerkUserId });
  while (auth.getCurrentUserId() === clerkUserId) {
    const [record] = await dependencies.list(clerkUserId);
    if (!record || record.clerkUserId !== clerkUserId) break;

    let authToken: string | null;
    try {
      authToken = await auth.getToken();
    } catch {
      // Keep the record queued if Clerk is in the middle of a session change.
      break;
    }
    // Clerk's getToken follows the live session. Check both the live hook
    // identity and the token subject so a session update racing React's render
    // cannot hand this A-owned queue a B token.
    if (
      !authToken ||
      auth.getCurrentUserId() !== clerkUserId ||
      tokenSubject(authToken) !== clerkUserId
    ) {
      break;
    }

    try {
      const syncedLead = await dependencies.create(record, authToken);
      // A switch while the request was in flight cannot change the request's
      // explicit bearer identity. Remove only after that owner-bound request
      // succeeds; otherwise the next sign-in can safely retry the record.
      await dependencies.remove(record);
      dependencies.notify?.({
        orgId: record.orgId,
        clerkUserId,
        syncedLead,
      });
    } catch (error) {
      await dependencies.update({
        ...record,
        lastError: error instanceof Error ? error.message : "Sync failed",
      });
      dependencies.notify?.({ orgId: record.orgId, clerkUserId });
      break;
    }
  }
}

export function syncLeadQueue(
  clerkUserId?: string,
  auth?: LeadSyncAuth,
  dependencies: LeadQueueSyncDependencies = defaultSyncDependencies,
): Promise<void> {
  if (!clerkUserId || !auth) return Promise.resolve();
  const existing = syncPromises.get(clerkUserId);
  if (existing) return existing;

  let promise: Promise<void>;
  promise = syncLeadQueueForUser(clerkUserId, auth, dependencies).finally(() => {
    if (syncPromises.get(clerkUserId) === promise) {
      syncPromises.delete(clerkUserId);
    }
    dependencies.notify?.({ clerkUserId });
  });
  syncPromises.set(clerkUserId, promise);
  return promise;
}

export function subscribeToLeadQueue(listener: (detail: LeadQueueChange) => void): () => void {
  const onChange = (event: Event) =>
    listener((event as CustomEvent<LeadQueueChange>).detail ?? {});
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

export function isLeadQueueSyncing(clerkUserId?: string): boolean {
  return clerkUserId ? syncPromises.has(clerkUserId) : syncPromises.size > 0;
}
