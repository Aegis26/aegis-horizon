import { useQueryClient } from "@tanstack/react-query";
import { useActOnLeadQueue } from "@workspace/api-client-react";
import type { LeadQueueAction } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { invalidateLeadQueue, isConflict, queueErrorMessage } from "@/lib/lead-queue";

const SUCCESS: Record<string, string> = {
  claim: "Lead claimed",
  assign: "Lead assigned",
  return: "Lead returned to queue",
  dismiss: "Lead dismissed",
};

export function useLeadQueueActions(orgId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mutation = useActOnLeadQueue();

  const act = (leadId: string, data: LeadQueueAction, company: string, onDone?: () => void) => {
    mutation.mutate(
      { orgId, leadId, data },
      {
        onSuccess: () => {
          invalidateLeadQueue(queryClient, orgId);
          toast({ title: SUCCESS[data.action] ?? "Updated", description: company });
          onDone?.();
        },
        onError: (error) => {
          invalidateLeadQueue(queryClient, orgId);
          toast({
            title: isConflict(error) ? "Lead no longer available" : "Action failed",
            description: queueErrorMessage(error, "Please try again."),
            variant: "destructive",
          });
          if (isConflict(error)) onDone?.();
        },
      },
    );
  };

  return {
    act,
    pending: mutation.isPending,
    pendingLeadId: mutation.isPending ? mutation.variables?.leadId : undefined,
  };
}
