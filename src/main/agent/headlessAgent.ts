import { generateText } from "ai";
import type { Tab } from "../Tab";
import { SYSTEM_BLIND, buildHeadlessPrompt } from "./promptBuilder";
import {
  type AgentEvent,
  type AgentStep,
  parseOrRepairAgentStep,
} from "./agentSchema";
import {
  executeAgentStep,
  type LastReadCapture,
} from "./agentExecute";
import { generateResearchReportMarkdown } from "./reportWriter";
import { saveAgentReport } from "./agentReportStorage";
import { getAgentLanguageModel, writeUserConclusion, sleep } from "./agentHelpers";

type ReportSegmentStored = { url: string; title: string; body: string };

export class HeadlessAgent {
  private abortController: AbortController | null = null;

  stop(): void {
    this.abortController?.abort();
  }

  async run(options: {
    goal: string;
    hiddenTab: Tab;
    emit: (event: AgentEvent) => void;
    maxSteps?: number;
  }): Promise<void> {
    const { goal, hiddenTab, emit, maxSteps = 10 } = options;
    const model = getAgentLanguageModel();
    if (!model) {
      emit({ type: "error", message: "Agent LLM not configured." });
      return;
    }

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const historyLines: string[] = [];
    let pendingPageSnapshot: string | null = null;
    let lastReadCapture: LastReadCapture | null = null;
    const reportSegments: ReportSegmentStored[] = [];
    let executedSteps = 0;
    
    try {
      while (executedSteps < maxSteps) {
        if (signal.aborted) {
          emit({ type: "finished", reason: "stopped" });
          return;
        }

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

        const visionBase = buildHeadlessPrompt({
          goal,
          executedSteps,
          maxSteps,
          reportSegmentsLength: reportSegments.length,
          url: hiddenTab.url,
          title: hiddenTab.title,
          recent,
          snapshotSection,
        });

        let action: AgentStep;
        try {
          const { text } = await generateText({
            model,
            system: SYSTEM_BLIND,
            abortSignal: signal,
            maxRetries: 1,
            maxOutputTokens: 8192,
            messages: [{ role: "user", content: [{ type: "text", text: visionBase }] }],
          });
          action = await parseOrRepairAgentStep(text, model, signal, emit);
        } catch (e) {
          emit({ type: "error", message: `llm_error: ${String(e)}` });
          return;
        }

        // Ignore visual actions in headless
        if (action.action === "see" || action.action === "click_xy" || action.action === "type" || action.action === "scroll" || action.action === "press_enter") {
            emit({ type: "log", message: `[agent] skipped visual action ${action.action} in headless mode.`});
            historyLines.push(JSON.stringify(action));
            executedSteps += 1;
            continue;
        }

        emit({ type: "step", step: executedSteps + 1, action });

        if (action.action === "done") {
          const summary = action.summary.trim();
          const conclusion = await writeUserConclusion({ goal, historyLines, agentDoneSummary: summary, model, signal });
          emit({ type: "conclusion", text: conclusion });

          if (reportSegments.length > 0) {
              emit({ type: "report_generating" });
              try {
                  const segments = reportSegments.map((s, i) => ({ index: i + 1, url: s.url, title: s.title, body: s.body }));
                  const { markdown, title } = await generateResearchReportMarkdown({ goal, segments, historyLines, signal });
                  const { id, viewerUrl } = await saveAgentReport({ title, markdown });
                  emit({ type: "report", id, title, url: viewerUrl });
              } catch (e) {
                  emit({ type: "report_error", message: `Report error: ${String(e)}` });
              }
          } else {
              // Fallback if they didn't use save_report
              emit({ type: "report_error", message: "Agent finished but did not save any report segments. No report generated." });
          }
          emit({ type: "finished", reason: summary || "done" });
          return;
        }

        try {
          // Fake createTabAndActivate for headless, since we only use one hidden tab
          const execResult = await executeAgentStep(
            hiddenTab,
            action,
            null, // no dims
            () => hiddenTab, 
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
          emit({ type: "error", message: `execute_step_failed: ${String(execErr)}` });
          return;
        }
        
        historyLines.push(JSON.stringify(action));
        executedSteps += 1;
        await sleep(350);
      }

      emit({ type: "error", message: `max_steps reached` });
    } finally {
      this.abortController = null;
    }
  }
}
