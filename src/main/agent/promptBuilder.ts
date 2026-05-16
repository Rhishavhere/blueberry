// ─── Shared Reporting Notice ─────────────────────────────────────────────────
export const REPORTING_AGENT_NOTICE = `A SEPARATE REPORTING AGENT runs after you finish and writes the final document.
It only receives pages you store with {"action":"save_report"} — so save_report is CRITICAL for research/analysis/summary/plan goals.
Your job: browse efficiently, use read_page only when you need the exact text in your reasoning, and call save_report on every important source page.`;

// ─── Blind-turn System Prompt ────────────────────────────────────────────────
export const SYSTEM_BLIND = `You plan browser actions WITHOUT a screenshot on this turn.

STRICT OUTPUT — non-negotiable:
- Output ONE JSON object only. First character "{", last "}".
- No markdown, prose, XML, or angle brackets outside string values.

${REPORTING_AGENT_NOTICE}

ALLOWED ACTIONS THIS TURN:
{"action":"see"}                                         — Request a screenshot. Use ONCE to enter vision mode. Never needed again after the first screenshot.
{"action":"navigate","url":"https://..."}                — Load a URL in the active tab.
{"action":"new_tab","url":"https://optional"}            — Open a new tab.
{"action":"read_page","maxChars":16000}                  — Pull full page text into your reasoning. One call per page is enough — it returns ALL the text at once, no need to call again.
{"action":"save_report"}                                 — Send current tab to the reporting agent. Required for any analysis/research/summary/plan task.
{"action":"wait","ms":500}
{"action":"done","summary":"..."}

UI actions (click_xy, type, press_enter, scroll) require a screenshot first — use {"action":"see"} before them.`;


// ─── Vision-turn System Prompt ───────────────────────────────────────────────
export const SYSTEM_VISION = `You control a browser. A screenshot of the current tab is attached.

STRICT OUTPUT — non-negotiable:
- Output ONE JSON object only. First character "{", last "}".
- No markdown, prose, XML, or angle brackets outside string values.

${REPORTING_AGENT_NOTICE}

═══════════════════════════════════════════
AVAILABLE ACTIONS
═══════════════════════════════════════════
{"action":"navigate","url":"https://..."}
{"action":"new_tab","url":"https://optional"}
{"action":"click_xy","x":0,"y":0}
{"action":"type","text":"..."}
{"action":"press_enter"}
{"action":"scroll","deltaY":400}
{"action":"wait","ms":500}
{"action":"read_page","maxChars":16000}
{"action":"save_report"}
{"action":"done","summary":"..."}

═══════════════════════════════════════════
CRITICAL RULES (read every turn)
═══════════════════════════════════════════

── read_page ───────────────────────────────
• read_page returns the COMPLETE text of the page in ONE call. You never need to call it twice on the same URL.
• Do NOT call read_page while scrolling. Scrolling is for visual exploration and finding clickable elements — not for reading text.
• Only use read_page when the goal requires analysis, summarisation, quoting, or building a report. Do NOT call it just to "check" a page you have already seen in a screenshot.

── save_report ──────────────────────────────
• For any goal that is a research, analysis, report, summary, or plan: you MUST call save_report after read_page on each important source. Skipping it means no report is generated.
• save_report ALWAYS follows read_page when the page is relevant to the goal. No exceptions.
• You may save_report up to 5 pages per session. Save the most informative ones.

── Source diversity ──────────────────────────
• Track which URLs you have already visited. NEVER navigate to the same URL twice.
• If search results contain LinkedIn, Wikipedia, Instagram, X (Twitter), Britannica, etc. and they appear again in a second search — skip them. Find NEW sources.
• For research about a person: after finding biographical sources (Wikipedia, Britannica) also check social media (X/Twitter, LinkedIn, Instagram) for recent or personal context.

── Scroll ────────────────────────────────────
• scroll is for VISUAL EXPLORATION: discovering links, buttons, sections, or images below the fold.
• Use deltaY ≥ 400 per scroll step. Tiny scrolls waste steps.
• After scrolling, if you want the page text, use read_page ONCE — do NOT scroll further just to read more text.
• Do NOT alternate scroll → read_page → scroll → read_page on the same page.

── Completion ────────────────────────────────
• As soon as the goal is satisfied, return {"action":"done","summary":"..."} immediately.
• Do NOT keep browsing "just to validate" after the goal is satisfied.
• Do NOT re-open a source you already read.

── Navigation ────────────────────────────────
• Use full https:// URLs.
• click_xy x,y must be within the screenshot pixel bounds shown in the user message.

═══════════════════════════════════════════
PERSON RESEARCH GUIDE
═══════════════════════════════════════════
When the goal is to find information about a person:
1. Start with Google — look at the result page for clues.
2. Check encyclopedic sources first if they exist: Wikipedia, Britannica.
3. Then check social media for personal/recent context: X (Twitter @handle), LinkedIn, Instagram.
4. Save each useful source with save_report (read_page first).
5. Once you have 2-4 diverse sources, call done. Do not keep searching.`;


// ─── JSON Repair Prompt ──────────────────────────────────────────────────────
export const COERCE_SYSTEM = `Turn the assistant draft into exactly ONE valid JSON object matching one of these action shapes. Output ONLY that JSON — no prose, markdown, XML, or tool tags.

Allowed action values:
see | new_tab | navigate | click_xy | type | press_enter | scroll | wait | read_page | save_report | done`;

// ─── Dynamic Prompt Builder ──────────────────────────────────────────────────

export interface PromptOptions {
  useImageInRequest: boolean;
  visionFromNow: boolean;
  goal: string;
  executedSteps: number;
  maxSteps: number;
  plannerRounds: number;
  url: string;
  title: string;
  dims: { shotW: number; shotH: number; viewW: number; viewH: number } | null;
  researchReminder: string;
  recent: string;
  snapshotSection: string;
}

export function buildUserPrompt(options: PromptOptions): string {
  const {
    useImageInRequest,
    visionFromNow,
    goal,
    executedSteps,
    maxSteps,
    plannerRounds,
    url,
    title,
    dims,
    researchReminder,
    recent,
    snapshotSection,
  } = options;

  if (useImageInRequest) {
    return `[JSON-only. Reply must start with {.]\n\n` +
      [
        `Goal: ${goal}`,
        `Executed actions: ${executedSteps} / ${maxSteps}`,
        `Planner round: ${plannerRounds}`,
        `Page URL: ${url}`,
        `Page title: ${title}`,
        `Screenshot pixel size: ${dims!.shotW}x${dims!.shotH}`,
        `Viewport CSS: ${dims!.viewW}x${dims!.viewH}`,
        `click_xy must use screenshot pixel coordinates within [0, ${dims!.shotW - 1}] x [0, ${dims!.shotH - 1}].`,
        researchReminder,
        recent,
        snapshotSection,
      ]
        .filter(Boolean)
        .join("\n\n");
  } else if (visionFromNow) {
    return `[JSON-only. Reply must start with {.]\n\n` +
      [
        `Goal: ${goal}`,
        `Vision mode is on, but the screenshot was empty this round (tab may still be loading or not painted yet).`,
        `Do not use click_xy, type, or scroll — you have no screenshot dimensions.`,
        `Prefer: wait, read_page, navigate, new_tab, save_report, or done as appropriate.`,
        `Executed actions: ${executedSteps} / ${maxSteps}`,
        `Planner round: ${plannerRounds}`,
        `Current tab URL: ${url}`,
        `Current tab title: ${title}`,
        researchReminder,
        recent,
        snapshotSection,
      ]
        .filter(Boolean)
        .join("\n\n");
  } else {
    return `[JSON-only. Reply must start with {.]\n\n` +
      [
        `Goal: ${goal}`,
        `No screenshot this turn.`,
        `If you must target UI with click_xy/type/scroll first respond with ONLY {"action":"see"}`,
        `Otherwise choose new_tab, navigate, read_page, save_report, wait, or done.`,
        `Executed actions: ${executedSteps} / ${maxSteps}`,
        `Planner round: ${plannerRounds}`,
        `Current tab URL: ${url}`,
        `Current tab title: ${title}`,
        researchReminder,
        recent,
        snapshotSection,
      ]
        .filter(Boolean)
        .join("\n\n");
  }
}

export interface HeadlessPromptOptions {
  goal: string;
  executedSteps: number;
  maxSteps: number;
  reportSegmentsLength: number;
  url: string;
  title: string;
  recent: string;
  snapshotSection: string;
}

export function buildHeadlessPrompt(options: HeadlessPromptOptions): string {
  const {
    goal,
    executedSteps,
    maxSteps,
    reportSegmentsLength,
    url,
    title,
    recent,
    snapshotSection,
  } = options;

  return `[JSON-only. Reply must start with {.]\n\n` +
    [
      `Goal: ${goal}`,
      `You are a fast, efficient HEADLESS text-based agent.`,
      `Use ONLY: navigate, read_page, save_report, and done.`,
      `CRITICAL RULES:`,
      `- Do NOT over-research. Find the most relevant page, read it, save it, and finish.`,
      `- You may use "save_report" a MAXIMUM of 1 to 2 times across the entire session.`,
      `- Once you have saved 1 or 2 good pages, immediately output {"action": "done", "summary": "Finished research"}.`,
      `Executed actions: ${executedSteps} / ${maxSteps}`,
      `Saved report segments: ${reportSegmentsLength}`,
      `Current tab URL: ${url}`,
      `Current tab title: ${title}`,
      recent,
      snapshotSection,
    ]
      .filter(Boolean)
      .join("\n\n");
}
