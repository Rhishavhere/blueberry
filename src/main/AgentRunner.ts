import { generateText, type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import * as dotenv from "dotenv";
import { join } from "path";
import type { Tab } from "./Tab";
import { SYSTEM_BLIND, SYSTEM_VISION } from "./agent/agentPrompts";
import {
  type AgentEvent,
  type AgentStep,
  parseOrRepairAgentStep,
} from "./agent/agentSchema";
import {
  executeAgentStep,
  type LastReadCapture,
  type VisionDims,
} from "./agent/agentExecute";
import { generateResearchReportMarkdown } from "./agent/reportWriter";
import { saveAgentReport } from "./agent/agentReportStorage";

dotenv.config({ path: join(__dirname, "../../.env") });

export type { AgentStep, AgentEvent } from "./agent/agentSchema";
export { AgentStepSchema } from "./agent/agentSchema";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeUserConclusion(args: {
  goal: string;
  historyLines: readonly string[];
  agentDoneSummary: string;
  model: LanguageModel | null;
  signal: AbortSignal;
}): Promise<string> {
  const { goal, historyLines, agentDoneSummary, model, signal } = args;
  if (!model) {
    return `${agentDoneSummary}`;
  }
  const trace =
    historyLines.length > 0
      ? historyLines.join("\n")
      : "(no recorded actions)";
  try {
    const { text } = await generateText({
      model,
      system: `Write a concise conclusion for someone who delegated a browsing task.
2-3 sentences, friendly and clear. Mention what happened, whether the stated goal appears satisfied, any notable page or search results, and what the user might do next when relevant.

Rules: casual language only — no JSON, no XML tags, no bullet lists framed as markdown if you can avoid them. Do not apologize excessively.`,
      temperature: 0.35,
      maxOutputTokens: 450,
      abortSignal: signal,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                `User goal: ${goal}`,
                "",
                `Agent closing note (technical): ${agentDoneSummary}`,
                "",
                `Action trace (recent lines):`,
                trace,
              ].join("\n"),
            },
          ],
        },
      ],
    });
    const out = text.trim();
    return out.length > 0 ? out : agentDoneSummary;
  } catch {
    return agentDoneSummary;
  }
}

function getAgentLanguageModel(): LanguageModel | null {
  const provider =
    process.env.LLM_PROVIDER?.toLowerCase() === "anthropic"
      ? "anthropic"
      : "openai";
  const modelId =
    process.env.AGENT_MODEL ||
    (provider === "anthropic" ? "claude-3-5-haiku-20241022" : "gpt-4o-mini");
  if (provider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) return null;
    return anthropic(modelId);
  }
  if (!process.env.OPENAI_API_KEY) return null;
  return openai(modelId);
}

type ReportSegmentStored = { url: string; title: string; body: string };

async function runResearchReportPipeline(args: {
  goal: string;
  segments: ReportSegmentStored[];
  historyLines: readonly string[];
  emit: (event: AgentEvent) => void;
  signal: AbortSignal;
}): Promise<void> {
  if (args.segments.length === 0 || args.signal.aborted) return;
  args.emit({ type: "report_generating" });
  try {
    const segments = args.segments.map((s, i) => ({
      index: i + 1,
      url: s.url,
      title: s.title,
      body: s.body,
    }));
    const { markdown, title } = await generateResearchReportMarkdown({
      goal: args.goal,
      segments,
      historyLines: args.historyLines,
      signal: args.signal,
    });
    const { id, viewerUrl } = await saveAgentReport({
      title,
      markdown,
    });
    args.emit({
      type: "report",
      id,
      title,
      url: viewerUrl,
    });
  } catch (e) {
    args.emit({
      type: "report_error",
      message: `Report writer failed: ${String(e)}`,
    });
  }
}

export class AgentRunner {
  private abortController: AbortController | null = null;
  private currentRunId = 0;

  stop(): void {
    this.currentRunId++; // invalidate the current run
    this.abortController?.abort();
    this.abortController = null;
  }

  async run(options: {
    goal: string;
    getActiveTab: () => Tab | null;
    /** Create a new tab (home if url omitted), make it active, return it */
    createTabAndActivate: (url?: string) => Tab;
    emit: (event: AgentEvent) => void;
    maxSteps?: number;
  }): Promise<void> {
    const {
      goal,
      getActiveTab,
      createTabAndActivate,
      emit,
      maxSteps = 60,
    } = options;
    const model = getAgentLanguageModel();
    if (!model) {
      emit({
        type: "conclusion",
        text: "The agent cannot start because no LLM is configured. Add ANTHROPIC_API_KEY or OPENAI_API_KEY (and LLM_PROVIDER) to your .env file.",
      });
      emit({
        type: "error",
        message:
          "Agent model not configured: set ANTHROPIC_API_KEY or OPENAI_API_KEY and LLM_PROVIDER if needed.",
      });
      return;
    }

    this.abortController?.abort(); // stop any previous run
    this.abortController = new AbortController();
    const myRunId = ++this.currentRunId;
    const { signal } = this.abortController;

    const historyLines: string[] = [];
    /** After true, every planner call attaches a screenshot. */
    let visionFromNow = false;
    /** Injected into the next planner user message once, then cleared. */
    let pendingPageSnapshot: string | null = null;
    /** Last read_page capture for save_report reuse on same URL. */
    let lastReadCapture: LastReadCapture | null = null;
    /** Content handed off to the reporting agent via save_report. */
    const reportSegments: ReportSegmentStored[] = [];
    /** Counts executed browser actions (not see-only, not done). */
    let executedSteps = 0;
    /** Prevents infinite planning loops before first execute */
    let plannerRounds = 0;
    const maxPlannerRounds = maxSteps * 4 + 12;
    /** Track visited URLs to prevent the agent re-visiting the same source. */
    // const visitedUrls = new Set<string>();
    /** Flag: was the last action a read_page on this URL? Prevents double-read. */
    let lastReadPageUrl: string | null = null;
    /** Detect if this is a research/analysis goal that requires save_report. */
    const isResearchGoal = /research|analysiss|summary|report|plan|find out/i.test(goal);

    try {
      while (executedSteps < maxSteps && plannerRounds < maxPlannerRounds) {
        if (signal.aborted) {
          emit({
            type: "conclusion",
            text: "Stopped before completion. Try running again with the same or a narrower goal.",
          });
          emit({ type: "finished", reason: "stopped" });
          return;
        }

        plannerRounds += 1;

        const tab = getActiveTab();
        if (!tab) {
          emit({
            type: "conclusion",
            text: "No active tab was found. Create or select a tab first, then run the agent again.",
          });
          emit({ type: "error", message: "no_active_tab" });
          return;
        }

        let dims: VisionDims | null = null;
        let imageDataUrl = "";
        let hasValidScreenshot = false;

        if (visionFromNow) {
          try {
            let native = await tab.screenshot();
            for (let attempt = 1; attempt <= 3 && native.isEmpty(); attempt++) {
              emit({
                type: "log",
                message: `[agent] Screenshot empty, retry ${attempt}/3`,
              });
              await sleep(200 + attempt * 100);
              native = await tab.screenshot();
            }
            if (native.isEmpty()) {
              emit({
                type: "log",
                message:
                  "[agent] Screenshot still empty after retries — planner turn is text-only until capture works.",
              });
            } else {
              imageDataUrl = native.toDataURL();
              const afterComma =
                imageDataUrl.slice(imageDataUrl.indexOf("base64,") + 7) || "";
              if (afterComma.replace(/\s/g, "").length < 32) {
                emit({
                  type: "log",
                  message:
                    "[agent] Screenshot data URL had no payload — treating as no image this turn.",
                });
                imageDataUrl = "";
              } else {
                hasValidScreenshot = true;
                const size = native.getSize();
                const vp = (await tab.runJs(
                  "(() => [window.innerWidth, window.innerHeight])()",
                )) as [number, number];
                dims = {
                  shotW: size.width,
                  shotH: size.height,
                  viewW: vp[0],
                  viewH: vp[1],
                };
              }
            }
          } catch (e) {
            if (signal.aborted) {
              emit({ type: "conclusion", text: "Stopped." });
              emit({ type: "finished", reason: "stopped" });
              return;
            }
            emit({
              type: "conclusion",
              text: `Couldn't capture the active tab: ${String(e)}. Check that a tab is visible and try again.`,
            });
            emit({ type: "error", message: `screenshot_failed: ${String(e)}` });
            return;
          }
        }

        const useImageInRequest = visionFromNow && hasValidScreenshot;

        const recent =
          historyLines.length > 0
            ? `Full action history:\n${historyLines.join("\n")}`
            : "";

        const snapshotSection =
          pendingPageSnapshot !== null
            ? [
                "---",
                "Page snapshot (included once after read_page — use exact text for quotes and summaries):",
                pendingPageSnapshot,
                "---",
              ].join("\n\n")
            : "";

        pendingPageSnapshot = null;

        // const visitedSummary = visitedUrls.size > 0
        //   ? `Already visited (do NOT navigate to these again): ${[...visitedUrls].join(", ")}`
        //   : "";
        const researchReminder = isResearchGoal
          ? "REMINDER: This is a research/analysis goal. You MUST call save_report after read_page on important sources. The reporting agent has no data unless you do."
          : "";

        const visionBase = useImageInRequest
          ? `[JSON-only. Reply must start with {.]\n\n` +
            [
              `Goal: ${goal}`,
              `Executed actions: ${executedSteps} / ${maxSteps}`,
              `Planner round: ${plannerRounds}`,
              `Page URL: ${tab.url}`,
              `Page title: ${tab.title}`,
              `Screenshot pixel size: ${dims!.shotW}x${dims!.shotH}`,
              `Viewport CSS: ${dims!.viewW}x${dims!.viewH}`,
              `click_xy must use screenshot pixel coordinates within [0, ${dims!.shotW - 1}] x [0, ${dims!.shotH - 1}].`,
              researchReminder,
              // visitedSummary,
              recent,
              snapshotSection,
            ]
              .filter(Boolean)
              .join("\n\n")
          : visionFromNow
            ? `[JSON-only. Reply must start with {.]\n\n` +
              [
                `Goal: ${goal}`,
                `Vision mode is on, but the screenshot was empty this round (tab may still be loading or not painted yet).`,
                `Do not use click_xy, type, or scroll — you have no screenshot dimensions.`,
                `Prefer: wait, read_page, navigate, new_tab, save_report, or done as appropriate.`,
                `Executed actions: ${executedSteps} / ${maxSteps}`,
                `Planner round: ${plannerRounds}`,
                `Current tab URL: ${tab.url}`,
                `Current tab title: ${tab.title}`,
                researchReminder,
                // visitedSummary,
                recent,
                snapshotSection,
              ]
                .filter(Boolean)
                .join("\n\n")
            : `[JSON-only. Reply must start with {.]\n\n` +
              [
                `Goal: ${goal}`,
                `No screenshot this turn.`,
                `If you must target UI with click_xy/type/scroll first respond with ONLY {"action":"see"}`,
                `Otherwise choose new_tab, navigate, read_page, save_report, wait, or done.`,
                `Executed actions: ${executedSteps} / ${maxSteps}`,
                `Planner round: ${plannerRounds}`,
                `Current tab URL: ${tab.url}`,
                `Current tab title: ${tab.title}`,
                researchReminder,
                // visitedSummary,
                recent,
                snapshotSection,
              ]
                .filter(Boolean)
                .join("\n\n");

        const system = useImageInRequest ? SYSTEM_VISION : SYSTEM_BLIND;
        const userContent = useImageInRequest
          ? ([
              { type: "image" as const, image: imageDataUrl },
              { type: "text" as const, text: visionBase },
            ] as const)
          : [{ type: "text" as const, text: visionBase }];

        let action: AgentStep;
        try {
          const { text } = await generateText({
            model,
            system,
            abortSignal: signal,
            maxRetries: 1,
            temperature: 0,
            maxOutputTokens: visionFromNow ? 12_288 : 12_288,
            messages: [{ role: "user", content: [...userContent] }],
          });
          action = await parseOrRepairAgentStep(text, model, signal, emit);
        } catch (e) {
          if (signal.aborted) {
            emit({ type: "conclusion", text: "Stopped." });
            emit({ type: "finished", reason: "stopped" });
            return;
          }
          emit({
            type: "conclusion",
            text: "The planner hit an error while talking to the AI. Check your API key and model name in .env, then retry.",
          });
          emit({ type: "error", message: `llm_error: ${String(e)}` });
          return;
        }

        if (action.action === "see") {
          if (visionFromNow) {
            emit({
              type: "log",
              message:
                "[agent] see ignored — screenshots already sent every turn.",
            });
            continue;
          }
          emit({
            type: "log",
            message:
              "[agent] Screenshot requested; next planner round uses vision.",
          });
          visionFromNow = true;
          continue;
        }

        if (
          visionFromNow &&
          !useImageInRequest &&
          (action.action === "click_xy" ||
            action.action === "type" ||
            action.action === "press_enter" ||
            action.action === "scroll")
        ) {
          emit({
            type: "log",
            message:
              "[agent] Skipping UI action — screenshot was empty this round; prefer wait or read_page.",
          });
          continue;
        }

        if (
          !visionFromNow &&
          (action.action === "click_xy" ||
            action.action === "type" ||
            action.action === "press_enter" ||
            action.action === "scroll")
        ) {
          emit({
            type: "conclusion",
            text: 'This step needs a screenshot first. The agent should reply with only {"action":"see"} before clicking or typing.',
          });
          emit({
            type: "error",
            message:
              'blind_turn: use {"action":"see"} once before click_xy, type, press_enter, or scroll.',
          });
          return;
        }

        // The emit step is moved below the guards so blocked actions don't show in UI.
        // ── Runtime guard: block re-navigating to an already-visited URL ────
        // if (action.action === "navigate") {
        //   const normalised = action.url.split("#")[0].split("?")[0].toLowerCase();
        //   if (visitedUrls.has(normalised)) {
        //     emit({ type: "log", message: `[guard] Blocked duplicate navigate to ${action.url} — already visited this source.` });
        //     historyLines.push(`{"action":"navigate_blocked_duplicate","url":"${action.url}"}`);
        //     executedSteps += 1;
        //     continue;
        //   }
        // }

        // ── Runtime guard: block a second read_page on the same URL ─────────
        if (action.action === "read_page") {
          const tab = getActiveTab();
          if (tab && lastReadPageUrl === tab.url) {
            emit({ type: "log", message: `[guard] Blocked duplicate read_page on ${tab.url}.` });
            historyLines.push(`{"action":"error","message":"You ALREADY called read_page on this URL. It is blocked. DO NOT call read_page again until you navigate somewhere else. Call save_report or done."}`);
            // Do NOT increment executedSteps so it doesn't count against budget
            continue;
          }
        }

        // Emit the step to the UI only if it passes all guards
        emit({ type: "step", step: executedSteps + 1, action });

        if (action.action === "done") {
          const summary = action.summary.trim();
          emit({
            type: "conclusion",
            text: await writeUserConclusion({
              goal,
              historyLines,
              agentDoneSummary:
                summary ||
                "The agent indicated the task is finished (no extra detail).",
              model,
              signal,
            }),
          });
          await runResearchReportPipeline({
            goal,
            segments: reportSegments,
            historyLines,
            emit,
            signal,
          });
          emit({ type: "finished", reason: summary || "done" });
          return;
        }

        try {
          const execResult = await executeAgentStep(
            tab,
            action,
            dims,
            createTabAndActivate,
            emit,
            { lastReadCapture },
          );
          if (execResult?.injectOncePageSnapshot) {
            pendingPageSnapshot = execResult.injectOncePageSnapshot;
          }
          if (execResult?.lastReadCapture) {
            lastReadCapture = execResult.lastReadCapture;
          }
          if (execResult?.savedReportSegment) {
            reportSegments.push(execResult.savedReportSegment);
            lastReadCapture = null;
          }
        } catch (execErr) {
          if (signal.aborted) {
            emit({ type: "conclusion", text: "Stopped." });
            emit({ type: "finished", reason: "stopped" });
            return;
          }
          emit({
            type: "conclusion",
            text: `Something went wrong while executing that action: ${String(execErr)}`,
          });
          emit({
            type: "error",
            message: `execute_step_failed: ${String(execErr)}`,
          });
          return;
        }
        historyLines.push(JSON.stringify(action));
        executedSteps += 1;
        visionFromNow = true;

        // ── Post-execute bookkeeping ─────────────────────────────────────────
        // if (action.action === "navigate") {
        //   const normalised = action.url.split("#")[0].split("?")[0].toLowerCase();
        //   visitedUrls.add(normalised);
        //   lastReadPageUrl = null; // new page, reset read guard
        // }
        if (action.action === "read_page") {
          const tab = getActiveTab();
          if (tab) lastReadPageUrl = tab.url;
        }

        await sleep(350);
      }

      if (executedSteps >= maxSteps) {
        emit({
          type: "conclusion",
          text: `Ran out of allowed actions (${maxSteps} steps) before the agent signaled completion. Increase the limit or shorten the goal.`,
        });
        await runResearchReportPipeline({
          goal,
          segments: reportSegments,
          historyLines,
          emit,
          signal,
        });
        emit({ type: "finished", reason: "max_steps" });
      } else {
        emit({
          type: "conclusion",
          text: `Stopped because the planner hit too many rounds (${maxPlannerRounds}). The agent may have been looping (for example screenshot requests). Try a clearer goal or rerun.`,
        });
        await runResearchReportPipeline({
          goal,
          segments: reportSegments,
          historyLines,
          emit,
          signal,
        });
        emit({ type: "finished", reason: "max_planner_rounds" });
      }
    } finally {
      // Only clear the controller if it still belongs to this run
      if (myRunId === this.currentRunId) {
        this.abortController = null;
      }
    }
  }
}
