import React, { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, Terminal, X, Check, Clock, Play, AlertTriangle, MessageSquare, Plus, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useOrgStore } from "@/store/org-store";
import {
  useProcessTextCommand,
  useConfirmTextCommand,
  useListCommandHistory,
  getListCommandHistoryQueryKey,
} from "@workspace/api-client-react";
import type { CommandHistoryEntry, CommandPendingResponse, CommandResultResponse } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";

interface SpeechRecognitionErrorEvent extends Event {
  error: 'no-speech' | 'aborted' | 'audio-capture' | 'network' | 'not-allowed' | 'service-not-allowed' | 'bad-grammar' | 'language-not-supported';
  message: string;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: { prototype: SpeechRecognition; new(): SpeechRecognition };
    webkitSpeechRecognition: { prototype: SpeechRecognition; new(): SpeechRecognition };
  }
}

export function CommandCenter() {
  const { selectedOrgId } = useOrgStore();
  const orgId = selectedOrgId || "";
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  if (!orgId) return null;

  return (
    <>
      {/* Floating Trigger */}
      <div className="fixed bottom-6 right-6 z-50 flex gap-2">
        <Button
          variant="outline"
          size="icon"
          className="h-12 w-12 rounded-full border-primary/20 bg-background/80 shadow-glow backdrop-blur-md hover:bg-primary/10 hover:border-primary/50"
          onClick={() => setOpen(true)}
        >
          <Terminal className="h-5 w-5 text-primary" />
        </Button>
      </div>

      {open && (
        <CommandPanel
          orgId={orgId}
          onClose={() => setOpen(false)}
          onToggleHistory={() => setHistoryOpen(!historyOpen)}
          historyOpen={historyOpen}
        />
      )}
    </>
  );
}

function CommandPanel({ orgId, onClose, onToggleHistory, historyOpen }: { orgId: string; onClose: () => void; onToggleHistory: () => void; historyOpen: boolean; }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const processCommand = useProcessTextCommand();
  const confirmCommand = useConfirmTextCommand();

  const [transcript, setTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const [pendingCommand, setPendingCommand] = useState<CommandPendingResponse | null>(null);
  const [lastResult, setLastResult] = useState<CommandResultResponse | null>(null);
  const [isBudgetExhausted, setIsBudgetExhausted] = useState(false);

  const { data: history } = useListCommandHistory(orgId, {
    query: {
      enabled: historyOpen,
      queryKey: getListCommandHistoryQueryKey(orgId)
    }
  });

  useEffect(() => {
    // Feature detect
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognitionAPI) {
      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => setIsListening(true);

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let currentTranscript = "";
        for (let i = 0; i < event.results.length; i++) {
          currentTranscript += event.results[i][0].transcript;
        }
        setTranscript(currentTranscript);
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error("Speech recognition error", event.error);
        setIsListening(false);
        if (event.error === 'not-allowed') {
          toast({ title: "Microphone blocked", description: "Please allow microphone access to use voice commands.", variant: "destructive" });
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current.onstart = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
      }
    };
  }, [toast]);

  const toggleListen = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setTranscript("");
      try {
        recognitionRef.current?.start();
      } catch (err) {
        toast({ title: "Voice not available", description: "Speech recognition is not supported or was blocked.", variant: "destructive" });
      }
    }
  };

  const handleProcess = () => {
    if (!transcript.trim()) return;

    setPendingCommand(null);
    setLastResult(null);
    setIsBudgetExhausted(false);

    processCommand.mutate(
      { orgId, data: { transcript: transcript.trim() } },
      {
        onSuccess: (res) => {
          setPendingCommand(res);
          queryClient.invalidateQueries({ queryKey: getListCommandHistoryQueryKey(orgId) });
        },
        onError: (err: unknown) => {
          const apiError = err as { status?: number, message?: string };
          if (apiError.status === 429) {
            setIsBudgetExhausted(true);
          } else {
            toast({ title: "Processing failed", description: apiError.message || "Could not process command", variant: "destructive" });
          }
        }
      }
    );
  };

  const handleConfirm = () => {
    if (!pendingCommand) return;
    setIsBudgetExhausted(false);

    confirmCommand.mutate(
      { orgId, commandId: pendingCommand.commandId },
      {
        onSuccess: (res) => {
          setLastResult(res);
          setPendingCommand(null);
          setTranscript("");
          queryClient.invalidateQueries({ queryKey: getListCommandHistoryQueryKey(orgId) });
          toast({ title: "Command executed successfully" });
        },
        onError: (err: unknown) => {
          const apiError = err as { status?: number, message?: string };
          if (apiError.status === 429) {
            setIsBudgetExhausted(true);
          } else {
            toast({ title: "Execution failed", description: apiError.message || "Could not execute command", variant: "destructive" });
          }
        }
      }
    );
  };

  return (
    <Card className="fixed bottom-20 right-6 w-96 max-h-[80vh] flex flex-col shadow-xl z-50 border-primary/20 bg-background/95 backdrop-blur-xl animate-scaleInEntrance">
      <div className="flex items-center justify-between p-4 border-b border-primary/10">
        <div className="flex items-center gap-2 text-primary font-display font-semibold">
          <Terminal className="h-4 w-4" /> Aegis Command
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={onToggleHistory}>
            <Clock className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {historyOpen ? (
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Command History</h4>
            {(!history || history.length === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-4">No history yet.</p>
            ) : (
              history.map((entry) => (
                <div key={entry.id} className="p-3 bg-card border border-primary/10 rounded-md space-y-2">
                  <div className="flex justify-between items-start gap-2 text-sm">
                    <p className="font-medium text-foreground">&quot;{entry.transcript}&quot;</p>
                    <Badge variant="outline" className="text-[10px] uppercase font-mono">{entry.status.replace(/_/g, " ")}</Badge>
                  </div>
                  {entry.action && (
                    <p className="text-xs font-mono text-primary bg-primary/5 p-1.5 rounded">Action: {entry.action.replace(/_/g, " ")}</p>
                  )}
                  {entry.errorMessage && (
                    <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="h-3 w-3"/> {entry.errorMessage}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground text-right">{formatDate(entry.createdAt)}</p>
                </div>
              ))
            )}
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div className="relative">
                <Input
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleProcess();
                    }
                  }}
                  placeholder="e.g. Schedule a call with Acme Corp tomorrow"
                  className="pr-12 h-12 bg-card font-sans shadow-inner border-primary/20 focus-visible:border-primary"
                  disabled={processCommand.isPending || confirmCommand.isPending}
                />
                {recognitionRef.current ? (
                  <Button
                    size="icon"
                    variant={isListening ? "default" : "ghost"}
                    className={`absolute right-1 top-1 h-10 w-10 ${isListening ? "bg-destructive hover:bg-destructive text-destructive-foreground animate-pulse" : "text-muted-foreground hover:text-primary"}`}
                    onClick={toggleListen}
                  >
                    {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </Button>
                ) : (
                  <div className="absolute right-3 top-3 text-[10px] text-muted-foreground uppercase font-bold tracking-widest pointer-events-none">
                    Type
                  </div>
                )}
              </div>

              {!recognitionRef.current && (
                <p className="text-[10px] text-muted-foreground text-center">Speech recognition is not supported in this browser. Typed commands remain available.</p>
              )}

              <Button
                className="w-full font-display"
                onClick={handleProcess}
                disabled={!transcript.trim() || processCommand.isPending || isListening}
              >
                {processCommand.isPending ? "Analyzing..." : "Process Command"}
              </Button>
            </div>

            {pendingCommand && (
              <div className="p-4 bg-primary/10 border border-primary/30 rounded-lg space-y-4 mt-4 animate-fadeInBlur">
                <div className="flex items-center gap-2 text-primary font-display font-medium">
                  <AlertTriangle className="h-4 w-4" /> Action Interpreted
                </div>

                <div className="space-y-2">
                  {pendingCommand.interpretation.commands.map((cmd, idx) => (
                    <div key={idx} className="p-2 bg-background/50 rounded border border-primary/10">
                      <p className="text-sm font-mono font-bold text-foreground capitalize">{cmd.action.replace(/_/g, " ")}</p>
                      {(cmd.date || cmd.time) && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {cmd.date} {cmd.time}
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 pt-2">
                  <Button variant="outline" className="flex-1" onClick={() => setPendingCommand(null)}>Cancel</Button>
                  <Button
                    className="flex-1 gap-2"
                    onClick={handleConfirm}
                    disabled={confirmCommand.isPending}
                  >
                    <Check className="h-4 w-4"/> {confirmCommand.isPending ? "Confirming..." : "Confirm Action"}
                  </Button>
                </div>
              </div>
            )}

            {isBudgetExhausted && (
              <div className="p-4 bg-warning/10 border border-warning/30 rounded-lg space-y-3 mt-4 animate-fadeInBlur text-center">
                <div className="flex items-center justify-center gap-2 text-warning font-display font-medium mb-1">
                  <AlertTriangle className="h-4 w-4" /> Usage Limit Reached
                </div>
                <p className="text-xs text-warning-foreground">Your organization has exhausted its monthly AI token budget. Voice commands cannot be processed until the next billing cycle.</p>
              </div>
            )}

            {lastResult && (
              <div className="p-4 bg-success/10 border border-success/30 rounded-lg space-y-3 mt-4 animate-fadeInBlur">
                <div className="flex items-center gap-2 text-success font-display font-medium">
                  <CheckCircle2 className="h-4 w-4" /> Action Completed
                </div>
                {lastResult.result.scheduledTask && (
                  <div className="text-sm">
                    <p className="text-muted-foreground mb-1">Created task:</p>
                    <p className="font-medium text-foreground">{lastResult.result.scheduledTask.title}</p>
                  </div>
                )}
                {lastResult.result.largestOpenDeal && (
                  <div className="text-sm">
                    <p className="text-muted-foreground mb-1">Largest Deal:</p>
                    <p className="font-medium text-foreground">{lastResult.result.largestOpenDeal.name}</p>
                    <p className="font-mono text-primary mt-1">{lastResult.result.largestOpenDeal.value ? `$${Number(lastResult.result.largestOpenDeal.value).toLocaleString()}` : "N/A"}</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
