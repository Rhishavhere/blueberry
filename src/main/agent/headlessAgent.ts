import { generateText, type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { Tab } from "../Tab";
import { SYSTEM_BLIND } from "./agentPrompts";
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ReportSegmentStored = { url: string; title: string; body: string };

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
      system: `Write a really concise conclusion for someone who delegated a browsing task.
1-2 sentences, friendly and clear. Mention what happened, whether the stated goal appears satisfied, any notable page or search results, and what the user might do next when relevant.

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
                `Agent closing note: ${agentDoneSummary}`,
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

        const visionBase = `[JSON-only. Reply must start with {.]\n\n` +
          [
            `Goal: ${goal}`,
            `You are a fast, efficient HEADLESS text-based agent.`,
            `Use ONLY: navigate, read_page, save_report, and done.`,
            `CRITICAL RULES:`,
            `- Do NOT over-research. Find the most relevant page, read it, save it, and finish.`,
            `- You may use "save_report" a MAXIMUM of 1 to 2 times across the entire session.`,
            `- Once you have saved 1 or 2 good pages, immediately output {"action": "done", "summary": "Finished research"}.`,
            `Executed actions: ${executedSteps} / ${maxSteps}`,
            `Saved report segments: ${reportSegments.length}`,
            `Current tab URL: ${hiddenTab.url}`,
            `Current tab title: ${hiddenTab.title}`,
            recent,
            snapshotSection,
          ]
            .filter(Boolean)
            .join("\n\n");

        let action: AgentStep;
        try {
          const { text } = await generateText({
            model,
            system: SYSTEM_BLIND,
            abortSignal: signal,
            maxRetries: 1,
            temperature: 0,
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
