import React, { useState, useEffect } from "react";
import { Bot, Bookmark, Plus, PanelRight, Search, Trash2, X, BookOpen, ExternalLink, Clock } from "lucide-react";
import { cn } from "@common/lib/utils";
import { useDarkMode } from "@common/hooks/useDarkMode";

type QueryMode = "search" | "agent";
type HomeTab = "home" | "routines" | "articles";

interface Routine {
  id: string;
  name: string;
  query: string;
  createdAt: string;
  schedule?: {
    type: "daily" | "weekly" | "hourly";
    time?: string;
    dayOfWeek?: number;
    enabled: boolean;
  };
  lastRun?: string;
  nextRun?: string;
}

function queryToNavigateUrl(raw: string): string {
  const q = raw.trim();
  if (!q) return "https://www.google.com";
  if (/^https?:\/\//i.test(q)) return q;
  const dotted = /\.[a-z]{2,}([/:?#]|$)/i.test(q);
  if (dotted && !q.includes(" "))
    return q.startsWith("http") ? q : `https://${q}`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en`;
}

const ModePill: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}> = ({ active, onClick, icon, label }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors",
      active
        ? "bg-primary text-primary-foreground shadow-sm"
        : "bg-muted/70 text-muted-foreground hover:bg-muted"
    )}
  >
    {icon}
    {label}
  </button>
);

const TabPill: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}> = ({ active, onClick, icon, label }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
      active
        ? "bg-foreground text-background"
        : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
    )}
  >
    {icon}
    {label}
  </button>
);

export const HomeApp: React.FC = () => {
  useDarkMode();
  const [homeTab, setHomeTab] = useState<HomeTab>("home");
  const [queryMode, setQueryMode] = useState<QueryMode>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routinesLoading, setRoutinesLoading] = useState(false);
  // Create routine form
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createQuery, setCreateQuery] = useState("");
  const [creating, setCreating] = useState(false);
  // Articles state
  const [reports, setReports] = useState<Array<{ id: string; title: string; createdAt: string }>>([]);
  const [reportsLoading, setReportsLoading] = useState(false);

  // Scheduling state
  const [schedulingRoutineId, setSchedulingRoutineId] = useState<string | null>(null);
  const [scheduleType, setScheduleType] = useState<"daily" | "weekly" | "hourly">("daily");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [scheduleDay, setScheduleDay] = useState(1); // Monday

  const loadRoutines = async () => {
    if (!window.routinesAPI) return;
    setRoutinesLoading(true);
    try {
      const r = await window.routinesAPI.getAll();
      setRoutines(r);
    } finally {
      setRoutinesLoading(false);
    }
  };

  useEffect(() => {
    void loadRoutines();
    void loadReports();
  }, []);

  const loadReports = async () => {
    if (!window.homeAPI) return;
    setReportsLoading(true);
    try {
      const r = await window.homeAPI.listReports();
      setReports(r);
    } finally {
      setReportsLoading(false);
    }
  };

  const handleDeleteRoutine = async (id: string) => {
    await window.routinesAPI.delete(id);
    setRoutines((prev) => prev.filter((r) => r.id !== id));
  };

  const handleCreateRoutine = async () => {
    const name = createName.trim();
    const query = createQuery.trim();
    if (!name || !query) return;
    setCreating(true);
    try {
      const res = await window.routinesAPI.save(name, query);
      if (res.ok) {
        setRoutines((prev) => [...prev, res.routine]);
        setCreateName("");
        setCreateQuery("");
        setShowCreate(false);
      }
    } finally {
      setCreating(false);
    }
  };

  const handleUseRoutine = async (routine: Routine) => {
    await window.homeAPI.openSidebarWithAgent({
      message: routine.query,
      messageId: Date.now().toString(),
    });
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;

    if (queryMode === "search") {
      const url = queryToNavigateUrl(q);
      await window.homeAPI.navigateFromSearch(url);
    } else {
      await window.homeAPI.openSidebarWithAgent({
        message: q,
        messageId: Date.now().toString(),
      });
      setSearchQuery("");
    }
  };

  return (
    <div className="relative flex flex-col min-h-screen">
      {/* Top nav */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 px-1 py-1 rounded-xl border border-border bg-card/80 backdrop-blur-sm shadow-sm">
        <TabPill
          active={homeTab === "home"}
          onClick={() => setHomeTab("home")}
          icon={<Search className="size-3.5" />}
          label="Home"
        />
        <TabPill
          active={homeTab === "routines"}
          onClick={() => { setHomeTab("routines"); void loadRoutines(); }}
          icon={<Bookmark className="size-3.5" />}
          label="Routines"
        />
        <TabPill
          active={homeTab === "articles"}
          onClick={() => { setHomeTab("articles"); void loadReports(); }}
          icon={<BookOpen className="size-3.5" />}
          label="Articles"
        />
      </div>

      <button
        type="button"
        onClick={() => void window.homeAPI.toggleSidebar()}
        className="absolute top-4 right-6 z-10 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs border border-border bg-card/80 hover:bg-muted backdrop-blur-sm"
      >
        <PanelRight className="size-4" />
        Sidebar
      </button>

      {/* Home Tab */}
      {homeTab === "home" && (
        <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
          <div className="w-full max-w-xl mx-auto flex flex-col items-center text-center space-y-10">
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight">Blueberry</h1>
              <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                Search the web with autonomous agents
              </p>
            </div>

            <form onSubmit={(e) => void onSubmit(e)} className="w-full space-y-4">
              <div
                className={cn(
                  "flex gap-2 p-2 rounded-2xl border border-border shadow-sm bg-card text-left",
                  "focus-within:ring-1 focus-within:ring-ring"
                )}
              >
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    queryMode === "search"
                      ? "Enter URL or Google Search"
                      : "Ask the agent…"
                  }
                  className="flex-1 min-w-0 bg-transparent px-3 py-2.5 text-sm outline-none"
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-xl px-5 py-2 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90"
                >
                  {queryMode === "search" ? "Go" : "Send"}
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2">
                <ModePill
                  active={queryMode === "search"}
                  onClick={() => setQueryMode("search")}
                  icon={<Search className="size-4" />}
                  label="Search"
                />
                <ModePill
                  active={queryMode === "agent"}
                  onClick={() => setQueryMode("agent")}
                  icon={<Bot className="size-4" />}
                  label="Agent"
                />
              </div>

              {queryMode === "agent" && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground max-w-md mx-auto">
                    Make Blueberry drive itself and get things done.
                  </p>
                </div>
              )}

              {queryMode === "search" && (
                <p className="text-xs text-muted-foreground">
                  Search the Internet. Paste an URL or Query
                </p>
              )}
            </form>

            <div className="pt-4 border-t border-border/60 w-full max-w-sm" />
          </div>
        </main>
      )}

      {/* Routines Tab */}
      {homeTab === "routines" && (
        <main className="flex-1 flex flex-col px-6 pt-20 pb-8 max-w-2xl mx-auto w-full">
          <div className="flex items-center gap-3 mb-6">
            <Bookmark className="size-5 text-primary" />
            <h1 className="text-xl font-semibold tracking-tight">Saved Routines</h1>
            <span className="text-xs text-muted-foreground">{routines.length} routine{routines.length !== 1 ? "s" : ""}</span>
            <div className="ml-auto">
              {showCreate ? (
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); setCreateName(""); setCreateQuery(""); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X className="size-3.5" /> Cancel
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                >
                  <Plus className="size-3.5" /> New Routine
                </button>
              )}
            </div>
          </div>

          {/* Create form */}
          {showCreate && (
            <div className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-sm space-y-3">
              <p className="text-xs font-semibold text-muted-foreground tracking-wide">New Routine</p>
              <div className="space-y-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Name <span className="font-mono">(used as @name)</span></label>
                  <input
                    autoFocus
                    type="text"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && createQuery.trim()) void handleCreateRoutine(); }}
                    placeholder="e.g. linkedin_update"
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Task / Query</label>
                  <textarea
                    value={createQuery}
                    onChange={(e) => setCreateQuery(e.target.value)}
                    placeholder="Describe what the agent should do…"
                    rows={3}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background outline-none focus:ring-1 focus:ring-ring resize-none"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); setCreateName(""); setCreateQuery(""); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!createName.trim() || !createQuery.trim() || creating}
                  onClick={() => void handleCreateRoutine()}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {creating ? "Saving…" : "Save Routine"}
                </button>
              </div>
            </div>
          )}

          {routinesLoading ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Loading…</div>
          ) : routines.length === 0 && !showCreate ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center py-20">
              <Bookmark className="size-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground max-w-xs">
                No routines yet. When an agent task completes, click <strong>Save Routine</strong> beside "All set!" to save it.
              </p>
              <p className="text-xs text-muted-foreground/70 font-mono">Then use @routine_name in any future task</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {routines.map((r) => (
                <li
                  key={r.id}
                  className="group flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-sm font-semibold text-primary">@{r.name}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(r.createdAt).toLocaleDateString()}
                        </span>
                        {r.schedule?.enabled && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                            <Clock className="size-3" />
                            Scheduled
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">{r.query}</p>
                      
                      {r.nextRun && r.schedule?.enabled && (
                        <div className="mt-2 text-[10px] text-muted-foreground flex items-center gap-1">
                          <Clock className="size-3" />
                          <span>Next run: {new Date(r.nextRun).toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => void handleUseRoutine(r)}
                        title="Run this routine"
                        className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-80 transition-opacity"
                      >
                        Run
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSchedulingRoutineId(schedulingRoutineId === r.id ? null : r.id);
                          if (r.schedule) {
                            setScheduleType(r.schedule.type);
                            setScheduleTime(r.schedule.time || "09:00");
                            setScheduleDay(r.schedule.dayOfWeek ?? 1);
                          }
                        }}
                        title="Schedule this routine"
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        <Clock className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteRoutine(r.id)}
                        title="Delete routine"
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Schedule Editor */}
                  {schedulingRoutineId === r.id && (
                    <div className="mt-2 pt-3 border-t border-border/60 text-xs space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">Configure Schedule</span>
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={r.schedule?.enabled ?? false}
                              onChange={async (e) => {
                                const enabled = e.target.checked;
                                await window.routinesAPI.updateSchedule(r.id, {
                                  type: scheduleType,
                                  time: scheduleTime,
                                  dayOfWeek: scheduleDay,
                                  enabled,
                                });
                                void loadRoutines();
                              }}
                              className="rounded border-border text-primary focus:ring-ring size-3"
                            />
                            <span>Enabled</span>
                          </label>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] text-muted-foreground mb-1 block">Frequency</label>
                          <select
                            value={scheduleType}
                            onChange={(e) => setScheduleType(e.target.value as any)}
                            className="w-full border border-border rounded-md px-2 py-1 bg-background outline-none focus:ring-1 focus:ring-ring text-xs"
                          >
                            <option value="hourly">Hourly</option>
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                          </select>
                        </div>

                        {scheduleType !== "hourly" && (
                          <div>
                            <label className="text-[10px] text-muted-foreground mb-1 block">Time</label>
                            <input
                              type="time"
                              value={scheduleTime}
                              onChange={(e) => setScheduleTime(e.target.value)}
                              className="w-full border border-border rounded-md px-2 py-1 bg-background outline-none focus:ring-1 focus:ring-ring text-xs"
                            />
                          </div>
                        )}

                        {scheduleType === "weekly" && (
                          <div>
                            <label className="text-[10px] text-muted-foreground mb-1 block">Day</label>
                            <select
                              value={scheduleDay}
                              onChange={(e) => setScheduleDay(Number(e.target.value))}
                              className="w-full border border-border rounded-md px-2 py-1 bg-background outline-none focus:ring-1 focus:ring-ring text-xs"
                            >
                              <option value={1}>Monday</option>
                              <option value={2}>Tuesday</option>
                              <option value={3}>Wednesday</option>
                              <option value={4}>Thursday</option>
                              <option value={5}>Friday</option>
                              <option value={6}>Saturday</option>
                              <option value={0}>Sunday</option>
                            </select>
                          </div>
                        )}
                      </div>

                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={async () => {
                            await window.routinesAPI.updateSchedule(r.id, {
                              type: scheduleType,
                              time: scheduleTime,
                              dayOfWeek: scheduleDay,
                              enabled: true,
                            });
                            setSchedulingRoutineId(null);
                            void loadRoutines();
                          }}
                          className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-primary text-primary-foreground hover:opacity-90"
                        >
                          Save Schedule
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </main>
      )}

      {/* Articles Tab */}
      {homeTab === "articles" && (
        <main className="flex-1 flex flex-col px-6 pt-20 pb-8 max-w-2xl mx-auto w-full">
          <div className="flex items-center gap-3 mb-6">
            <BookOpen className="size-5 text-primary" />
            <h1 className="text-xl font-semibold tracking-tight">Saved Reports</h1>
            <span className="text-xs text-muted-foreground">{reports.length} report{reports.length !== 1 ? "s" : ""}</span>
          </div>

          {reportsLoading ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Loading…</div>
          ) : reports.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center py-20">
              <BookOpen className="size-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground max-w-xs">
                No reports saved yet. Ask the agent to research something and save a report.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {reports.map((r) => (
                <li
                  key={r.id}
                  onClick={() => void window.homeAPI.openReport(r.id)}
                  className="group flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm hover:shadow-md transition-all cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="font-semibold text-sm text-foreground leading-snug line-clamp-2">{r.title}</h3>
                    <ExternalLink className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-medium">
                    <span>{new Date(r.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </main>
      )}
    </div>
  );
};
