import { useCallback, useEffect, useState } from "react";
import type { LeadCreate } from "@workspace/api-client-react";
import {
  enqueueLead,
  isLeadQueueSyncing,
  listQueuedLeads,
  subscribeToLeadQueue,
  syncLeadQueue,
  type QueuedLead,
} from "@/lib/offline-leads";

export function useOfflineLeads(orgId?: string) {
  const [pendingLeads, setPendingLeads] = useState<QueuedLead[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(isLeadQueueSyncing());

  const refresh = useCallback(async () => {
    setPendingLeads(await listQueuedLeads(orgId));
    setSyncing(isLeadQueueSyncing());
  }, [orgId]);

  useEffect(() => {
    void refresh();
    const onOnline = () => {
      setOnline(true);
      void syncLeadQueue();
    };
    const onOffline = () => setOnline(false);
    const unsubscribe = subscribeToLeadQueue(() => void refresh());
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    void syncLeadQueue();
    return () => {
      unsubscribe();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refresh]);

  const queueLead = useCallback(
    async (data: LeadCreate) => {
      if (!orgId) throw new Error("Select an organization before adding a lead.");
      return enqueueLead(orgId, data);
    },
    [orgId],
  );

  return { pendingLeads, online, syncing, queueLead, syncNow: syncLeadQueue };
}
