import { generateText, type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import * as dotenv from "dotenv";
import { join } from "path";
import type { Tab } from "../Tab";

dotenv.config({ path: join(__dirname, "../../../.env") });

const MAX_HTML_CONTEXT = 80_000;
const MAX_TEXT_CONTEXT = 24_000;

export type MutateRunResult =
  | {
      ok: true;
      message: string;
      js: string;
      executionResult: unknown;
    }
  | { ok: false; error: string };

const REDESIGN_SYSTEM = `You are Blueberry Browser's Redesign Feature. The user wants to visually transform the currently loaded web page.

You receive the user's Redesign instruction plus current page DOM/text context. Generate JavaScript that runs directly in the page via Electron executeJavaScript.

STRICT OUTPUT:
- Output ONLY JavaScript source code.
- No markdown fences, no explanation, no JSON, no XML.
- The code must be self-contained and safe to run multiple times.

BEHAVIOR:
- Mutate the current document in-place so the result is visible immediately.
- Prefer DOM/CSS changes: remove/hide/rearrange elements, add styles, highlight terms, simplify layout, translate visible labels if requested, or create a readable extracted view.
- Do not navigate, reload, use fetch/XMLHttpRequest/WebSocket, write cookies/localStorage/sessionStorage/indexedDB, or submit forms unless the user explicitly asks.
- Preserve the user's page content where possible. If simplifying, keep main readable content and provide a clear fallback when no article/main content exists.
- Add a small non-intrusive marker only when useful, using data-blueberry-redesign attributes so repeated runs can clean up old helper styles.
- Return a short string at the end describing what changed.`;

function getMutationLanguageModel(): LanguageModel | null {
  const provider =
    process.env.LLM_PROVIDER?.toLowerCase() === "anthropic"
      ? "anthropic"
      : "openai";
  const modelId =
    process.env.MUTATE_MODEL ||
    process.env.AGENT_MODEL ||
    (provider === "anthropic" ? "claude-3-5-haiku-20241022" : "gpt-4o-mini");
  if (provider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) return null;
    return anthropic(modelId);
  }
  if (!process.env.OPENAI_API_KEY) return null;
  return openai(modelId);
}

function stripMarkdownFence(raw: string): string {
  let text = raw.trim();
  const fence =
    /^```(?:javascript|js)?\s*\r?\n?([\s\S]*?)\r?\n?```$/i.exec(text) ??
    /```(?:javascript|js)?\s*\r?\n?([\s\S]*?)\r?\n?```/i.exec(text);
  if (fence) {
    text = fence[1].trim();
  }
  return text;
}

function wrapForExecution(js: string): string {
  return `(async () => {
${js}
})()`;
}

export async function runPageMutation(args: {
  tab: Tab;
  instruction: string;
}): Promise<MutateRunResult> {
  const instruction = args.instruction.trim();
  if (!instruction) {
    return { ok: false, error: "empty_mutate_instruction" };
  }

  const model = getMutationLanguageModel();
  if (!model) {
    return { ok: false, error: "mutate_model_not_configured" };
  }

  const [html, text] = await Promise.all([
    args.tab.getTabHtml(),
    args.tab.getTabText(),
  ]);

  const { text: generated } = await generateText({
    model,
    system: REDESIGN_SYSTEM,
    temperature: 0.2,
    maxRetries: 1,
    maxOutputTokens: 8192,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `Redesign instruction:`,
              instruction,
              "",
              `Current URL: ${args.tab.url}`,
              `Current title: ${args.tab.title}`,
              "",
              `Page visible text excerpt (${Math.min(text.length, MAX_TEXT_CONTEXT)} of ${text.length} chars):`,
              text.slice(0, MAX_TEXT_CONTEXT),
              "",
              `Page HTML excerpt (${Math.min(html.length, MAX_HTML_CONTEXT)} of ${html.length} chars):`,
              html.slice(0, MAX_HTML_CONTEXT),
              "",
              "Generate only the JavaScript to apply this redesign now.",
            ].join("\n"),
          },
        ],
      },
    ],
  });

  const js = stripMarkdownFence(generated);
  if (!js) {
    return { ok: false, error: "mutate_empty_js" };
  }

  const executionResult = await args.tab.runJs(wrapForExecution(js));
  const executionMessage =
    typeof executionResult === "string" && executionResult.trim()
      ? executionResult.trim()
      : "Page redesign applied.";
  return { ok: true, message: executionMessage, js, executionResult };
}
