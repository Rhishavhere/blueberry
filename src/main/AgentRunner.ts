import { generateText } from "ai";
import * as dotenv from "dotenv";
import { join } from "path";
import type { Tab } from "./Tab";
import { SYSTEM_BLIND, SYSTEM_VISION, buildUserPrompt } from "./agent/promptBuilder";
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
import { runResearchReportPipeline, type ReportSegmentStored } from "./agent/reportWriter";

import { getAgentLanguageModel, writeUserConclusion, sleep } from "./agent/agentHelpers";

dotenv.config({ path: join(__dirname, "../../.env") });

export type { AgentStep, AgentEvent } from "./agent/agentSchema";
export { AgentStepSchema } from "./agent/agentSchema";



interface AgentRunState {
  historyLines: string[];
  visionFromNow: boolean;
  pendingPageSnapshot: string | null;
  lastReadCapture: LastReadCapture | null;
  reportSegments: ReportSegmentStored[];
  executedSteps: number;
  plannerRounds: number;
  lastReadPageUrl: string | null;
  isResearchGoal: boolean;
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

    const state: AgentRunState = {
      historyLines: [],
      visionFromNow: false,
      pendingPageSnapshot: null,
      lastReadCapture: null,
      reportSegments: [],
      executedSteps: 0,
      plannerRounds: 0,
      lastReadPageUrl: null,
      isResearchGoal: /research|analysiss|summary|report|plan|find out/i.test(goal),
    };
    const maxPlannerRounds = maxSteps * 4 + 12;

    try {
      while (state.executedSteps < maxSteps && state.plannerRounds < maxPlannerRounds) {
        if (signal.aborted) {
          emit({
            type: "conclusion",
            text: "Stopped before completion. Try running again with the same or a narrower goal.",
          });
          emit({ type: "finished", reason: "stopped" });
          return;
        }

        state.plannerRounds += 1;

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

        if (state.visionFromNow) {
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

        const useImageInRequest = state.visionFromNow && hasValidScreenshot;

        const recent =
          state.historyLines.length > 0
            ? `Full action history:\n${state.historyLines.join("\n")}`
            : "";

        const snapshotSection =
          state.pendingPageSnapshot !== null
            ? [
                "---",
                "Page snapshot (included once after read_page — use exact text for quotes and summaries):",
                state.pendingPageSnapshot,
                "---",
              ].join("\n\n")
            : "";

        state.pendingPageSnapshot = null;

        const researchReminder = state.isResearchGoal
          ? "REMINDER: This is a research/analysis goal. You MUST call save_report after read_page on important sources. The reporting agent has no data unless you do."
          : "";

        const visionBase = buildUserPrompt({
          useImageInRequest,
          visionFromNow: state.visionFromNow,
          goal,
          executedSteps: state.executedSteps,
          maxSteps,
          plannerRounds: state.plannerRounds,
          url: tab.url,
          title: tab.title,
          dims,
          researchReminder,
          recent,
          snapshotSection,
        });

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
            maxOutputTokens: state.visionFromNow ? 12_288 : 12_288,
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
          if (state.visionFromNow) {
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
          state.visionFromNow = true;
          continue;
        }

        if (
          state.visionFromNow &&
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
          !state.visionFromNow &&
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
          if (tab && state.lastReadPageUrl === tab.url) {
            emit({ type: "log", message: `[guard] Blocked duplicate read_page on ${tab.url}.` });
            state.historyLines.push(`{"action":"error","message":"You ALREADY called read_page on this URL. It is blocked. DO NOT call read_page again until you navigate somewhere else. Call save_report or done."}`);
            // Do NOT increment executedSteps so it doesn't count against budget
            continue;
          }
        }

        // Emit the step to the UI only if it passes all guards
        emit({ type: "step", step: state.executedSteps + 1, action });

        if (action.action === "done") {
          const summary = action.summary.trim();
          emit({
            type: "conclusion",
            text: await writeUserConclusion({
              goal,
              historyLines: state.historyLines,
              agentDoneSummary:
                summary ||
                "The agent indicated the task is finished (no extra detail).",
              model,
              signal,
            }),
          });
          await runResearchReportPipeline({
            goal,
            segments: state.reportSegments,
            historyLines: state.historyLines,
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
            { lastReadCapture: state.lastReadCapture },
          );
          if (execResult?.injectOncePageSnapshot) {
            state.pendingPageSnapshot = execResult.injectOncePageSnapshot;
          }
          if (execResult?.lastReadCapture) {
            state.lastReadCapture = execResult.lastReadCapture;
          }
          if (execResult?.savedReportSegment) {
            state.reportSegments.push(execResult.savedReportSegment);
            state.lastReadCapture = null;
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
        state.historyLines.push(JSON.stringify(action));
        state.executedSteps += 1;
        state.visionFromNow = true;

        // ── Post-execute bookkeeping ─────────────────────────────────────────
        // if (action.action === "navigate") {
        //   const normalised = action.url.split("#")[0].split("?")[0].toLowerCase();
        //   visitedUrls.add(normalised);
        //   lastReadPageUrl = null; // new page, reset read guard
        // }
        if (action.action === "read_page") {
          const tab = getActiveTab();
          if (tab) state.lastReadPageUrl = tab.url;
        }

        await sleep(350);
      }

      if (state.executedSteps >= maxSteps) {
        emit({
          type: "conclusion",
          text: `Ran out of allowed actions (${maxSteps} steps) before the agent signaled completion. Increase the limit or shorten the goal.`,
        });
        await runResearchReportPipeline({
          goal,
          segments: state.reportSegments,
          historyLines: state.historyLines,
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
          segments: state.reportSegments,
          historyLines: state.historyLines,
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
