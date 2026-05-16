import { generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { COERCE_SYSTEM } from "./promptBuilder";

export const AgentStepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("see") }),
  z.object({ action: z.literal("new_tab"), url: z.string().optional() }),
  z.object({ action: z.literal("navigate"), url: z.string() }),
  z.object({
    action: z.literal("click_xy"),
    x: z.number(),
    y: z.number(),
  }),
  z.object({ action: z.literal("type"), text: z.string() }),
  z.object({ action: z.literal("press_enter") }),
  z.object({ action: z.literal("scroll"), deltaY: z.number() }),
  z.object({ action: z.literal("wait"), ms: z.number() }),
  z.object({
    action: z.literal("read_page"),
    maxChars: z.number().int().positive().max(200_000).optional(),
    includeHtml: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("save_report"),
    includeHtml: z.boolean().optional(),
  }),
  z.object({ action: z.literal("done"), summary: z.string() }),
]);

export type AgentStep = z.infer<typeof AgentStepSchema>;

export type AgentEvent =
  | { type: "log"; message: string }
  | { type: "step"; step: number; action: AgentStep }
  | { type: "conclusion"; text: string }
  | { type: "error"; message: string }
  | { type: "finished"; reason: string }
  | { type: "report"; id: string; title: string; url: string }
  | { type: "report_generating" }
  | { type: "report_error"; message: string };

export function parseAgentStepJson(raw: string): AgentStep {
  let t = raw.trim();
  const fence =
    /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```$/m.exec(t) ??
    /```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```/m.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`no_json_object_in_model_output: ${raw.slice(0, 200)}`);
  }
  let jsonSlice = t.slice(start, end + 1);
  jsonSlice = jsonSlice.replace(/,\s*([}\]])/g, "$1");
  let obj: unknown;
  try {
    obj = JSON.parse(jsonSlice) as unknown;
  } catch {
    throw new Error(`json_parse_failed: ${jsonSlice.slice(0, 240)}`);
  }
  const parsed = AgentStepSchema.safeParse(obj);
  if (!parsed.success) {
    throw new Error(`schema_mismatch: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function parseOrRepairAgentStep(
  visionText: string,
  model: LanguageModel,
  signal: AbortSignal,
  emit: (event: AgentEvent) => void,
): Promise<AgentStep> {
  try {
    return parseAgentStepJson(visionText);
  } catch (e1) {
    emit({
      type: "log",
      message: `[repair] Reply was not pure JSON (${String(e1).slice(0, 240)}…) — coercion pass`,
    });
  }

  const draft = visionText.trim().slice(0, 12_000);
  const { text } = await generateText({
    model,
    system: COERCE_SYSTEM,
    abortSignal: signal,
    maxRetries: 1,
    maxOutputTokens: 8192,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Convert this assistant draft into one JSON action object:\n\n${draft}`,
          },
        ],
      },
    ],
  });

  try {
    return parseAgentStepJson(text);
  } catch (e2) {
    throw new Error(
      `json_coercion_failed_after_repair: ${String(e2)} ; snippet=${visionText.slice(0, 120)}`,
    );
  }
}
