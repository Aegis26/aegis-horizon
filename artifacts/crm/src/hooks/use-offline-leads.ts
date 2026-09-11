import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/react";
import type { LeadCreate } from "@workspace/api-client-react";
import {
  enqueueLead,
  isLeadQueueSyncing,
  listQueuedLeads,
  subscribeToLeadQueue,
  syncLeadQueue,
  type LeadSyncAuth,
  type QueuedLead,
} from "@/lib/offline-leads";

export function useOfflineLeads(orgId?: string) {
  const { userId, getToken } = useAuth();
  const liveUserIdRef = useRef<string | null>(userId ?? null);
  // Keep this ref current during render so a pending sync observes a Clerk
  // switch before the next effect is scheduled.
  liveUserIdRef.current = userId ?? null;
  const syncAuth = useMemo<LeadSyncAuth>(
    () => ({
      getToken: () => getToken(),
      getCurrentUserId: () => liveUserIdRef.current,
    }),
    [getToken],
  );
  const [pendingLeads, setPendingLeads] = useState<QueuedLead[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(isLeadQueueSyncing(userId ?? undefined));

  const refresh = useCallback(async () => {
    setPendingLeads(await listQueuedLeads(orgId, userId ?? undefined));
    setSyncing(isLeadQueueSyncing(userId ?? undefined));
  }, [orgId, userId]);

  useEffect(() => {
    // Do not let a previous account or organization remain visible while
    // IndexedDB is loading the newly scoped queue.
    setPendingLeads([]);
    void refresh();
    const onOnline = () => {
      setOnline(true);
      void syncLeadQueue(userId ?? undefined, syncAuth);
    };
    const onOffline = () => setOnline(false);
    const unsubscribe = subscribeToLeadQueue(() => void refresh());
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    void syncLeadQueue(userId ?? undefined, syncAuth);
    return () => {
      unsubscribe();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refresh, syncAuth, userId]);

  const queueLead = useCallback(
    async (data: LeadCreate) => {
      if (!orgId) throw new Error("Select an organization before adding a lead.");
      if (!userId) throw new Error("Sign in before adding an offline lead.");
      return enqueueLead(orgId, data, userId, syncAuth);
    },
    [orgId, syncAuth, userId],
  );

  const syncNow = useCallback(
    () => syncLeadQueue(userId ?? undefined, syncAuth),
    [syncAuth, userId],
  );

  return { pendingLeads, online, syncing, queueLead, syncNow };
}
