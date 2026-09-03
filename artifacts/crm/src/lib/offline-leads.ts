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
  data: LeadCreate;
  createdAt: string;
  lastError?: string;
}

export interface LeadQueueChange {
  syncedLead?: Lead;
  orgId?: string;
}

let syncPromise: Promise<void> | null = null;

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

export async function listQueuedLeads(orgId?: string): Promise<QueuedLead[]> {
  const records = await withStore<QueuedLead[]>("readonly", (store) => store.getAll());
  return records
    .filter((record) => !orgId || record.orgId === orgId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function enqueueLead(orgId: string, data: LeadCreate): Promise<QueuedLead> {
  const key = newIdempotencyKey();
  const record: QueuedLead = {
    id: `pending-${key}`,
    idempotencyKey: key,
    orgId,
    data,
    createdAt: new Date().toISOString(),
  };
  await withStore<IDBValidKey>("readwrite", (store) => store.add(record));
  notify({ orgId });
  void syncLeadQueue();
  return record;
}

async function updateQueuedLead(record: QueuedLead): Promise<void> {
  await withStore<IDBValidKey>("readwrite", (store) => store.put(record));
}

async function deleteQueuedLead(id: string): Promise<void> {
  await withStore<undefined>("readwrite", (store) => store.delete(id));
}

export function syncLeadQueue(): Promise<void> {
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    notify();
    while (true) {
      const [record] = await listQueuedLeads();
      if (!record) break;
      try {
        const syncedLead = await createLead(record.orgId, record.data, {
          headers: { "Idempotency-Key": record.idempotencyKey },
        });
        await deleteQueuedLead(record.id);
        notify({ orgId: record.orgId, syncedLead });
      } catch (error) {
        await updateQueuedLead({
          ...record,
          lastError: error instanceof Error ? error.message : "Sync failed",
        });
        notify({ orgId: record.orgId });
        break;
      }
    }
  })().finally(() => {
    syncPromise = null;
    notify();
  });
  return syncPromise;
}

export function subscribeToLeadQueue(listener: (detail: LeadQueueChange) => void): () => void {
  const onChange = (event: Event) =>
    listener((event as CustomEvent<LeadQueueChange>).detail ?? {});
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

export function isLeadQueueSyncing(): boolean {
  return syncPromise !== null;
}
