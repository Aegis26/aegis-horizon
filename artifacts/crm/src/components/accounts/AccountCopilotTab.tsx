import { useState } from "react";
import {
  useGetAiBudgetStatus, getGetAiBudgetStatusQueryKey,
  useSummarizeWithCopilot,
  useGetCopilotNextAction,
  useDraftCopilotEmail,
} from "@workspace/api-client-react";
import type { CopilotSummary, NextActionRecommendation, DraftCopilotEmail200 } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Bot, Sparkles, Send, RefreshCw, Mail, Activity, Lock, Target } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatPredictionPercentage } from "@/lib/format";

export function AccountCopilotTab({ orgId, accountId }: { orgId: string; accountId: string }) {
  const { toast } = useToast();

  const { data: budget, error: budgetError } = useGetAiBudgetStatus(orgId, {
    query: { queryKey: getGetAiBudgetStatusQueryKey(orgId), retry: false }
  });

  const summarize = useSummarizeWithCopilot();
  const getNextAction = useGetCopilotNextAction();
  const draftEmail = useDraftCopilotEmail();

  const [summary, setSummary] = useState<CopilotSummary | null>(null);
  const [nextAction, setNextAction] = useState<NextActionRecommendation | null>(null);
  const [emailDraft, setEmailDraft] = useState<DraftCopilotEmail200 | null>(null);

  const [draftContext, setDraftContext] = useState("");
  const [editedSubject, setEditedSubject] = useState("");
  const [editedBody, setEditedBody] = useState("");

  const [isBudgetExhausted, setIsBudgetExhausted] = useState(false);

  // Check initial budget exhaustion from query
  if (budgetError && (budgetError as any).status === 429 && !isBudgetExhausted) {
    setIsBudgetExhausted(true);
  } else if (budget && budget.remaining <= 0 && !isBudgetExhausted) {
    setIsBudgetExhausted(true);
  }

  const isConsentEnabled = budget?.consentEnabled ?? false;

  if (!budget && !budgetError) {
    return <div className="h-64 skeleton rounded-xl"></div>;
  }

  if (isBudgetExhausted) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center bg-card border border-warning/30 rounded-lg p-8">
        <div className="h-16 w-16 bg-warning/10 rounded-full flex items-center justify-center mb-6">
          <AlertTriangle className="h-8 w-8 text-warning" />
        </div>
        <h3 className="text-xl font-bold font-display mb-2 text-warning">Usage Limit Reached</h3>
        <p className="text-muted-foreground max-w-md mb-6">
          Your organization has exhausted its monthly AI token budget. AI Copilot features are paused until the next billing cycle.
        </p>
      </div>
    );
  }

  if (budget && !isConsentEnabled) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center bg-card border border-primary/10 rounded-lg p-8">
        <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-6">
          <Lock className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-xl font-bold font-display mb-2">AI Features Disabled</h3>
        <p className="text-muted-foreground max-w-md mb-6">
          Organization consent is required to process data with AI models.
          An administrator must enable this in Settings.
        </p>
      </div>
    );
  }

  const handleError = (err: any, fallbackTitle: string) => {
    if (err.status === 429) {
      setIsBudgetExhausted(true);
    } else {
      toast({ title: fallbackTitle, description: err.message, variant: "destructive" });
    }
  };

  const handleSummarize = (style: "short" | "long") => {
    summarize.mutate(
      { orgId, data: { entityType: "account", entityId: accountId, style } },
      {
        onSuccess: (res) => {
          setSummary(res);
          toast({ title: "Summary generated" });
        },
        onError: (err: any) => handleError(err, "Failed to summarize")
      }
    );
  };

  const handleNextAction = () => {
    getNextAction.mutate(
      { orgId, data: { accountId } },
      {
        onSuccess: (res) => setNextAction(res),
        onError: (err: any) => handleError(err, "Failed to get next action")
      }
    );
  };

  const handleDraftEmail = () => {
    if (!draftContext.trim()) return;
    draftEmail.mutate(
      { orgId, data: { accountId, context: draftContext, tone: "professional" } },
      {
        onSuccess: (res) => {
          setEmailDraft(res);
          setEditedSubject("Following up");
          setEditedBody(res.draft || "");
          toast({ title: "Email drafted", description: "Review and edit before sending." });
        },
        onError: (err: any) => handleError(err, "Failed to draft email")
      }
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

      {/* Copilot Main Column */}
      <div className="lg:col-span-2 space-y-6">

        {/* Summarize */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-border/50">
            <CardTitle className="text-lg font-display flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" /> Account Summary
            </CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => handleSummarize("short")} disabled={summarize.isPending}>
                <Sparkles className="h-3 w-3 mr-1"/> Short
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleSummarize("long")} disabled={summarize.isPending}>
                <Sparkles className="h-3 w-3 mr-1"/> Long
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {summarize.isPending ? (
              <div className="space-y-2">
                <div className="h-4 skeleton rounded w-full"></div>
                <div className="h-4 skeleton rounded w-5/6"></div>
              </div>
            ) : summary ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className={`capitalize font-mono ${
                    summary.sentiment === 'positive' ? 'text-success border-success/30' :
                    summary.sentiment === 'negative' ? 'text-destructive border-destructive/30' :
                    'text-warning border-warning/30'
                  }`}>
                    {summary.sentiment}
                  </Badge>
                  <span className="text-xs text-muted-foreground font-mono">Topics: {summary.topics.join(", ")}</span>
                </div>
                <p className="text-sm text-foreground leading-relaxed">{summary.summaryShort}</p>
                {summary.summaryLong && (
                  <p className="text-sm text-muted-foreground leading-relaxed pt-2 border-t border-primary/10">{summary.summaryLong}</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">Generate an AI summary of this account's timeline and deals.</p>
            )}
          </CardContent>
        </Card>

        {/* Email Draft */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-border/50">
            <CardTitle className="text-lg font-display flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" /> Draft Communication
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            {!emailDraft ? (
              <>
                <div className="space-y-2">
                  <Textarea
                    placeholder="E.g., Follow up on yesterday's demo, mention the Q3 roadmap..."
                    value={draftContext}
                    onChange={(e) => setDraftContext(e.target.value)}
                    className="min-h-[100px] resize-none border-primary/20"
                  />
                </div>
                <Button onClick={handleDraftEmail} disabled={draftEmail.isPending || !draftContext.trim()} className="w-full gap-2">
                  <Sparkles className="h-4 w-4" /> {draftEmail.isPending ? "Drafting..." : "Generate Draft"}
                </Button>
              </>
            ) : (
              <div className="space-y-4 animate-scaleInEntrance">
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Subject</p>
                  <Input value={editedSubject} onChange={e => setEditedSubject(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Body</p>
                  <Textarea value={editedBody} onChange={e => setEditedBody(e.target.value)} className="min-h-[150px]" />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setEmailDraft(null)} className="flex-1">Discard</Button>
                  <Button className="flex-1 gap-2">
                    <Send className="h-4 w-4" /> Send Email (Simulated)
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground text-center">AI drafts require human review. Use Communications tab for real delivery.</p>
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      {/* Copilot Sidebar */}
      <div className="space-y-6">

        {/* Next Best Action */}
        <Card className="bg-primary/5 border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-md font-display flex items-center gap-2 text-primary">
              <Target className="h-4 w-4" /> Next Best Action
            </CardTitle>
          </CardHeader>
          <CardContent>
            {nextAction ? (
              <div className="space-y-3 animate-scaleInEntrance">
                <p className="font-bold text-foreground leading-tight">{nextAction.action}</p>
                <p className="text-xs text-muted-foreground">{nextAction.rationale}</p>
                <div className="flex justify-between items-center pt-2">
                  <span className="text-xs font-mono">Confidence: {formatPredictionPercentage(nextAction.confidence)}</span>
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground" onClick={handleNextAction} disabled={getNextAction.isPending}>
                    <RefreshCw className={`h-3 w-3 ${getNextAction.isPending ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <Button variant="outline" size="sm" onClick={handleNextAction} disabled={getNextAction.isPending} className="gap-2">
                  <Sparkles className="h-3 w-3" /> Get Recommendation
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI Budget */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-md font-display flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> Copilot Budget
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Tokens Used</span>
                  <span className="font-mono">{budget?.used.toLocaleString() || '0'} / {budget?.budget.toLocaleString() || '0'}</span>
                </div>
                <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full ${(budget?.remaining ?? 0) < 5000 ? 'bg-destructive' : 'bg-primary'}`}
                    style={{ width: `${Math.min(100, ((budget?.used ?? 0) / (budget?.budget ?? 1)) * 100)}%` }}
                  />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground text-center">Budget resets monthly.</p>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}