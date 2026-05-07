import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileText,
  ListOrdered,
  Loader2,
  Paintbrush,
  XCircle,
} from "lucide-react";
import { Button } from "@common/components/Button";
import { cn } from "@common/lib/utils";

type AgentEventPayload =
  | { type: "log"; message: string }
  | { type: "step"; step: number; action: Record<string, unknown> }
  | { type: "conclusion"; text: string }
  | { type: "error"; message: string }
  | { type: "finished"; reason: string }
  | { type: "report_generating" }
  | { type: "report_error"; message: string }
  | { type: "report"; id: string; title: string; url: string };

type StepRow = { step: number; label: string; raw: string };

type AgentPanelProps = {
  externalRunRequest?: {
    id: string;
    goal: string;
  } | null;
};

type RunStatus = "idle" | "running" | "completed" | "error";

function humanizeStep(action: Record<string, unknown>): string {
  const a = action.action;
  if (typeof a !== "string") return "Ran an action";
  switch (a) {
    case "see":
      return "Looked at the page (screenshot)";
    case "new_tab": {
      const u = action.url;
      return typeof u === "string" && u
        ? `Opened a new tab → ${u}`
        : "Opened a new tab";
    }
    case "navigate": {
      const u = action.url;
      return typeof u === "string"
        ? `Opened ${hostnameOnly(u)}`
        : "Navigated to a page";
    }
    case "click_xy":
      return "Clicked a thing";
    case "type": {
      const t = action.text;
      const s =
        typeof t === "string" ? (t.length > 42 ? `${t.slice(0, 42)}…` : t) : "";
      return s ? `Typed “${s}”` : "Typed text into the focused field";
    }
    case "press_enter":
      return "Pressed Enter";
    case "scroll":
      return typeof action.deltaY === "number"
        ? `Scrolled ${action.deltaY > 0 ? "down" : "up"} the page`
        : "Scrolled the page";
    case "wait":
      return typeof action.ms === "number"
        ? `Waited for the page (${action.ms} ms)`
        : "Waited for the page to settle";
    case "read_page":
      return "Read page text from the tab";
    case "save_report":
      return "Saved page for the research report";
    case "done":
      return "Wrapped up the task";
    default:
      return "Continued browsing";
  }
}

function hostnameOnly(url: string): string {
  try {
    const h = new URL(url).hostname;
    return h.replace(/^www\./, "");
  } catch {
    return url.slice(0, 48);
  }
}

export const AgentPanel: React.FC<AgentPanelProps> = ({
  externalRunRequest,
}) => {
  const [goal, setGoal] = useState("");
  const [running, setRunning] = useState(false);
  const [runHadError, setRunHadError] = useState(false);
  const [conclusion, setConclusion] = useState<string | null>(null);
  const [reportLinks, setReportLinks] = useState<
    Array<{ id: string; title: string; url: string }>
  >([]);
  const [reportGenerating, setReportGenerating] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [technicalLog, setTechnicalLog] = useState<string[]>([]);
  const [stepsExpanded, setStepsExpanded] = useState(false);
  /** Dedicated text for the bottom “what next?” field only (not synced to the request card). */
  const [composer, setComposer] = useState("");
  const [composerFocused, setComposerFocused] = useState(false);
  /** Redesign (page mutate) — toggle in header; send uses mutate-run. */
  const [redesignActive, setRedesignActive] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const status: RunStatus = useMemo(() => {
    if (running) return "running";
    if (runHadError) return "error";
    if (conclusion !== null || steps.length > 0) return "completed";
    return "idle";
  }, [running, runHadError, conclusion, steps.length]);

  const runRedesignMutation = useCallback(async (instruction: string) => {
    const trimmed = instruction.trim();
    if (!trimmed) {
      setTechnicalLog((prev) => [
        ...prev,
        "Redesign mode needs instructions in the box below.",
      ]);
      setRunHadError(true);
      setConclusion("Describe what you want changed on this page.");
      return false;
    }

    setSteps([]);
    setTechnicalLog([`[redesign] ${trimmed}`]);
    setConclusion(null);
    setReportLinks([]);
    setReportGenerating(false);
    setReportError(null);
    setRunHadError(false);
    setGoal(`Redesign — ${trimmed}`);
    setStepsExpanded(false);
    setRunning(true);

    try {
      const res = await window.sidebarAPI.mutateRun(trimmed);
      if (!res.ok) {
        setTechnicalLog((prev) => [...prev, `[redesign] ERROR: ${res.error}`]);
        setRunHadError(true);
        setConclusion(`Redesign failed: ${res.error}`);
        return false;
      }

      setSteps([
        {
          step: 1,
          label: "Redesigned the current page",
          raw: JSON.stringify({
            action: "redesign",
            instruction: trimmed,
            jsChars: res.js.length,
          }),
        },
      ]);
      setTechnicalLog((prev) => [
        ...prev,
        `[redesign] ${res.message}`,
        `[redesign] generated ${res.js.length} chars of JS`,
      ]);
      setConclusion(res.message || "Page redesign applied.");
      return true;
    } catch (e) {
      setTechnicalLog((prev) => [...prev, `[redesign] ERROR: ${String(e)}`]);
      setRunHadError(true);
      setConclusion(`Redesign failed: ${String(e)}`);
      return false;
    } finally {
      setRunning(false);
    }
  }, []);

  const beginRunFromGoal = useCallback(async (raw: string) => {
    const g = raw.trim();
    if (!g) return false;
    setRedesignActive(false);
    setSteps([]);
    setTechnicalLog([]);
    setConclusion(null);
    setReportLinks([]);
    setReportGenerating(false);
    setReportError(null);
    setRunHadError(false);
    setGoal(g);
    setStepsExpanded(false);
    setRunning(true);
    try {
      const res = await window.sidebarAPI.agentStart(g);
      if (!("ok" in res) || !res.ok) {
        const err =
          typeof res === "object" &&
          res &&
          "error" in res &&
          typeof (res as { error?: string }).error === "string"
            ? (res as { error: string }).error
            : String(res);
        setTechnicalLog((prev) => [...prev, `Failed to start: ${err}`]);
        setRunHadError(true);
        setRunning(false);
        setConclusion(
          `We couldn't start this run (${err}). Check the goal and try again.`,
        );
        return false;
      }
    } catch (e) {
      setTechnicalLog((prev) => [...prev, `Failed to start: ${String(e)}`]);
      setRunHadError(true);
      setRunning(false);
      setConclusion(`Something blocked the agent from starting: ${String(e)}`);
      return false;
    }
    return true;
  }, []);

  const submitComposer = useCallback(async () => {
    const text = composer.trim();
    if (!text || running) return;
    if (redesignActive) {
      const ok = await runRedesignMutation(text);
      if (ok) setComposer("");
      return;
    }
    const ok = await beginRunFromGoal(text);
    if (ok) setComposer("");
  }, [
    composer,
    running,
    redesignActive,
    runRedesignMutation,
    beginRunFromGoal,
  ]);

  useEffect(() => {
    if (!composerRef.current) return;
    composerRef.current.style.height = "auto";
    const scrollHeight = composerRef.current.scrollHeight;
    const newHeight = Math.min(scrollHeight, 200);
    composerRef.current.style.height = `${newHeight}px`;
  }, [composer]);

  useEffect(() => {
    const onEvent = (e: AgentEventPayload): void => {
      const ts = new Date().toISOString().slice(11, 19);
      if (e.type === "log") {
        setTechnicalLog((prev) => [...prev, `[${ts}] ${e.message}`]);
      } else if (e.type === "step") {
        const raw = JSON.stringify(e.action);
        const label = humanizeStep(e.action);
        setSteps((prev) => [...prev, { step: e.step, label, raw }]);
      } else if (e.type === "conclusion") {
        setConclusion(e.text.trim());
      } else if (e.type === "report_generating") {
        setReportGenerating(true);
        setReportError(null);
      } else if (e.type === "report_error") {
        setReportGenerating(false);
        setReportError(e.message);
      } else if (e.type === "report") {
        setReportGenerating(false);
        setReportError(null);
        setReportLinks((prev) => {
          if (prev.some((r) => r.id === e.id)) return prev;
          return [...prev, { id: e.id, title: e.title, url: e.url }];
        });
      } else if (e.type === "error") {
        setTechnicalLog((prev) => [...prev, `[${ts}] ERROR: ${e.message}`]);
        setRunning(false);
        setRunHadError(true);
      } else if (e.type === "finished") {
        setTechnicalLog((prev) => [...prev, `[${ts}] stopped (${e.reason})`]);
        setRunning(false);
      }
    };

    window.sidebarAPI.onAgentEvent(onEvent);
    return () => {
      window.sidebarAPI.removeAgentEventListener();
    };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [technicalLog]);

  useEffect(() => {
    if (!externalRunRequest) return;
    void beginRunFromGoal(externalRunRequest.goal);
  }, [externalRunRequest?.id, beginRunFromGoal]);

  const stop = (): void => {
    void window.sidebarAPI.agentStop();
    setRunning(false);
  };

  const clearRun = (): void => {
    stop();
    setSteps([]);
    setTechnicalLog([]);
    setConclusion(null);
    setReportLinks([]);
    setReportGenerating(false);
    setReportError(null);
    setRunHadError(false);
    setGoal("");
    setComposer("");
    setRedesignActive(false);
    setStepsExpanded(false);
  };

  const STEPS_PREVIEW = 4;
  const displayedSteps =
    stepsExpanded || steps.length <= STEPS_PREVIEW
      ? steps
      : steps.slice(0, STEPS_PREVIEW);

  const idleStatusLabel = useMemo(() => {
    if (status === "idle") return "Ready";
    if (status === "error") return "Needs attention";
    return "Completed";
  }, [status]);

  const isCleanSlate =
    !running && !goal.trim() && conclusion === null && steps.length === 0;

  return (
    <div className="flex flex-col h-full min-h-0 bg-gradient-to-b from-violet-50/40 dark:from-violet-950/20 via-background to-background">
      {/* Header */}
      <div className="shrink-0 px-4 pt-4 pb-2 flex items-start justify-between gap-2 border-b border-border/60 bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          {running ? (
            <>
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-200/80 bg-amber-50/90 dark:bg-amber-950/40 dark:border-amber-800 px-3 py-1 text-[11px] font-medium text-amber-950 dark:text-amber-50">
                <Loader2 className="size-3.5 animate-spin" />
                Working
              </span>
              <Button
                variant="outline"
                size="xs"
                type="button"
                className="h-7 px-2 text-[11px]"
                onClick={() => stop()}
              >
                Stop
              </Button>
              {redesignActive ? (
                <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  <Paintbrush className="size-3.5 shrink-0 opacity-70" />
                  Redesign
                  <button
                    type="button"
                    aria-label="Exit Redesign mode"
                    disabled={running}
                    className="ml-0.5 rounded px-1 text-muted-foreground/90 hover:bg-background/70 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setRedesignActive(false)}
                  >
                    ×
                  </button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="xs"
                  type="button"
                  className="h-7 px-2 text-[11px] gap-1"
                  disabled={running}
                  onClick={() => {
                    setRedesignActive(true);
                    requestAnimationFrame(() =>
                      composerRef.current?.focus(),
                    );
                  }}
                  title="Redesign the visible page"
                >
                  <Paintbrush className="size-3 shrink-0" />
                  Redesign
                </Button>
              )}
            </>
          ) : (
            <>
              <span
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-3 py-1 text-[11px] font-medium",
                  status === "completed" &&
                    "bg-emerald-50/95 text-emerald-950 dark:bg-emerald-950/35 dark:border-emerald-900 dark:text-emerald-50",
                  status === "error" &&
                    "bg-red-50/95 text-red-950 dark:bg-red-950/35 dark:border-red-900 dark:text-red-50",
                  status === "idle" && "bg-muted/60 text-muted-foreground",
                )}
              >
                {status !== "idle" && (
                  <span
                    className={cn(
                      "flex size-1.5 rounded-full",
                      status === "error" ? "bg-red-500" : "bg-emerald-500",
                    )}
                  />
                )}
                {idleStatusLabel}
              </span>
              {(steps.length > 0 ||
                conclusion ||
                reportLinks.length > 0 ||
                reportGenerating) && (
                <Button
                  variant="ghost"
                  size="xs"
                  type="button"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => clearRun()}
                >
                  New task
                </Button>
              )}
              {redesignActive ? (
                <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  <Paintbrush className="size-3.5 shrink-0 opacity-70" />
                  Redesign
                  <button
                    type="button"
                    aria-label="Exit Redesign mode"
                    disabled={running}
                    className="ml-0.5 rounded px-1 text-muted-foreground/90 hover:bg-background/70 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setRedesignActive(false)}
                  >
                    ×
                  </button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="xs"
                  type="button"
                  className="h-7 px-2 text-[11px] gap-1"
                  disabled={running}
                  onClick={() => {
                    setRedesignActive(true);
                    requestAnimationFrame(() =>
                      composerRef.current?.focus(),
                    );
                  }}
                  title="Redesign the visible page"
                >
                  <Paintbrush className="size-3 shrink-0" />
                  Redesign
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4 space-y-4">
        {isCleanSlate ? (
          <>
            <div className="flex items-center justify-center h-full min-h-[400px]">
              <div className="text-center animate-fade-in max-w-md mx-auto gap-2 flex flex-col">
                <p className="text-foreground text-sm">
                  Blueberry on Autopilot
                </p>
              </div>
            </div>
            <div
              className="absolute inset-0 pointer-events-none opacity-40 bg-bottom bg-no-repeat bg-[length:auto_75%] sm:bg-contain"
              style={{
                backgroundImage: "url('/act.png')",
                backgroundPositionY: 300,
                backgroundPositionX: -50,
              }}
              aria-hidden
            />
          </>
        ) : (
          <>
            {/* Request card */}
            <section
              className={cn(
                "rounded-2xl px-4 py-3 transition-colors",
                "bg-violet-500/5",
                running && "opacity-95",
              )}
            >
              <div className="flex gap-3 items-center">
                <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-white dark:bg-muted border border-violet-200/60 dark:border-border">
                  <ListOrdered className="size-4 text-violet-600 dark:text-violet-400" />
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  <p className="text-sm leading-relaxed font-semibold text-foreground whitespace-pre-wrap">
                    {goal}
                  </p>
                </div>
              </div>
            </section>

            {/* Result card */}
            <section className="rounded-2xl shadow-md overflow-hidden">
              <div
                className={cn(
                  "px-4 py-3",
                  running
                    ? "border-border/70 bg-muted/30"
                    : "border-emerald-100 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20",
                )}
              >
                <div className="flex gap-2 items-center">
                  {runHadError ? (
                    <XCircle className="size-5 text-red-500 mt-0.5 shrink-0" />
                  ) : running && conclusion === null ? (
                    <Loader2 className="size-5 animate-spin text-violet-600 mt-0.5 shrink-0" />
                  ) : (
                    <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-foreground">
                      {runHadError
                        ? "Couldnt finish cleanly"
                        : running && conclusion === null
                          ? "On it…"
                          : conclusion && reportGenerating
                            ? "Writing report…"
                            : conclusion
                              ? "All set!"
                              : "Your summary will appear here"}
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-4 space-y-4">
                {running && conclusion === null && (
                  <div className="space-y-2 animate-pulse">
                    <div className="h-3 bg-muted rounded w-5/6" />
                    <div className="h-3 bg-muted rounded w-full" />
                    <div className="h-3 bg-muted rounded w-4/6" />
                  </div>
                )}
                {conclusion && (
                  <div className="text-sm font-sans leading-relaxed text-foreground whitespace-pre-wrap space-y-2">
                    {conclusion.trim()}
                  </div>
                )}
                {reportGenerating && (
                  <div className="flex items-center gap-2 text-sm text-violet-700 dark:text-violet-300">
                    <Loader2 className="size-4 animate-spin shrink-0" />
                    Writing full research report…
                  </div>
                )}
                {reportError && (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {reportError}
                  </p>
                )}
                {reportLinks.length > 0 && (
                  <div className="space-y-2 pt-1 border-border/50">
                    <p className="text-xs font-semibold tracking-wide text-muted-foreground">
                      Full Report
                    </p>
                    <ul className="space-y-2">
                      {reportLinks.map((r) => (
                        <li key={r.id}>
                          <Button
                            variant="outline"
                            size="sm"
                            type="button"
                            className="w-full justify-start gap-2 h-auto py-2 px-3"
                            onClick={() =>
                              void window.sidebarAPI.openAgentReportTab(r.id)
                            }
                          >
                            <FileText className="size-4 shrink-0 text-violet-600 dark:text-violet-400" />
                            <span className="min-w-0 flex-1 text-left text-sm truncate">
                              {r.title}
                            </span>
                            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>

            {/* What I did */}
            {steps.length > 0 && (
              <details
                open
                className="group rounded-2xl dark:border-violet-900/40 bg-muted/40 dark:bg-muted/25 overflow-hidden"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden hover:bg-muted/50">
                  <span className="flex items-center gap-2 font-medium">
                    <ListOrdered className="size-4 text-black dark:text-violet-400 shrink-0" />
                    What I did
                  </span>
                  <span className="rounded-full shadow dark:bg-violet-950 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-100">
                    {steps.length} {steps.length === 1 ? "step" : "steps"}
                  </span>
                </summary>
                <ul className="border-t border-border/60 divide-y divide-border/50 pb-3">
                  {displayedSteps.map((s, i) => (
                    <li
                      key={`${s.step}-${i}`}
                      className="flex items-center gap-3 px-4 py-2.5 text-xs font-medium leading-snug"
                    >
                      <div className="w-2 h-2 rounded-full bg-green-400"></div>
                      <span className="text-foreground/60">{s.label}</span>
                    </li>
                  ))}
                </ul>
                {steps.length > STEPS_PREVIEW && (
                  <button
                    type="button"
                    className="w-full pb-3 text-center text-xs font-medium text-violet-600 dark:text-violet-400 hover:underline flex items-center justify-center gap-1"
                    onClick={() => setStepsExpanded((x) => !x)}
                  >
                    {stepsExpanded ? "Show fewer steps" : "View all steps"}
                    <ChevronDown
                      className={cn(
                        "size-4 transition-transform",
                        stepsExpanded && "rotate-180",
                      )}
                    />
                  </button>
                )}
              </details>
            )}

            <details className="rounded-xl border border-dashed border-border/80 bg-muted/15">
              <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Technical details
              </summary>
              <div className="max-h-[104px] overflow-y-auto px-3 pb-2 font-mono text-[10px] text-muted-foreground whitespace-pre-wrap">
                {technicalLog.length === 0 ? (
                  <span className="italic">Nothing logged yet.</span>
                ) : (
                  technicalLog.map((line, i) => (
                    <div key={`${i}-${line.slice(0, 28)}`}>{line}</div>
                  ))
                )}
                <div ref={logEndRef} />
              </div>
            </details>
          </>
        )}
      </div>

      {/* Bottom composer */}
      <div className="shrink-0 p-4">
        <div
          className={cn(
            "w-full border p-3 rounded-3xl bg-background dark:bg-secondary",
            "shadow-chat animate-spring-scale outline-none transition-all duration-200",
            composerFocused
              ? "border-primary/20 dark:border-primary/30"
              : "border-border",
          )}
        >
          <div className="w-full px-3 py-2">
            <div className="w-full flex items-start gap-3">
              <div className="relative flex-1 overflow-hidden">
                <textarea
                  ref={composerRef}
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  onFocus={() => setComposerFocused(true)}
                  onBlur={() => setComposerFocused(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (!running && composer.trim()) void submitComposer();
                    }
                  }}
                  placeholder={
                    redesignActive
                      ? "Describe how to change this page…"
                      : "Ask the agent a favour..."
                  }
                  disabled={running}
                  className="w-full resize-none outline-none bg-transparent text-foreground placeholder:text-muted-foreground min-h-[24px] max-h-[200px] disabled:opacity-55"
                  rows={1}
                  style={{ lineHeight: "24px" }}
                />
              </div>
            </div>
          </div>

          <div className="w-full flex items-center gap-1.5 px-1 mt-2 mb-1">
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => void submitComposer()}
              disabled={running || !composer.trim()}
              aria-label="Run agent"
              className={cn(
                "size-9 rounded-full flex items-center justify-center",
                "transition-all duration-200",
                "bg-primary text-primary-foreground",
                "hover:opacity-80 disabled:opacity-50",
              )}
            >
              {running ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <ArrowUp className="size-5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
