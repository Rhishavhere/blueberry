import { generateText, type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { saveAgentReport } from "./agentReportStorage";
import type { AgentEvent } from "./agentSchema";

export type ReportSegmentInput = {
  index: number;
  url: string;
  title: string;
  body: string;
};

const MAX_BODY_PER_SEGMENT = 80_000;

const REPORT_SYSTEM = `You are a dedicated research-report writer. You receive the user's original task and raw page text excerpts a browser agent saved. Your job is ONE polished Markdown document for a beautiful on-screen reader (headings, lists, tables, clear hierarchy).

OUTPUT RULES (strict):
- Output ONLY Markdown. No JSON, XML, HTML wrapper, or prose before/after the document. First line should be the main title.
- Start with exactly one level-1 heading: a single line "# <Descriptive report title>" summarizing the user's task and findings. Do not add extra H1s later.
- Structure the body with "##" for major sections (e.g. Overview, Key findings, Details, Sources). Use "###" for subsections. Never skip levels (no jumping from # to ### without ## in between for that branch).
- Prefer 3-7 "##" sections so the report scans like a professional brief, not a blob of text.
- Be human readable, casual and explanor
- The whole output should be beautifully formatted and highly presentable.


FORMATTING FOR READABILITY:
- Paragraphs: 4-6 sentences max; blank line between every paragraph.
- Lists: Use "- " for unordered lists. Use "1. " ordered lists only for sequences, rankings, or step-by-step items. Indent sub-bullets with two spaces before "- ". Keep list items concise; combine related points.
- Labels in lists: when defining terms or facts, use bold lead labels: "**Label:** explanation" at the start of a list item when it aids scanning.
- Emphasis: use **bold** for key entities, figures, dates, names, verdicts — sparingly so it stays scannable.

TABLES AND QUOTES:
- Use GitHub-flavored Markdown tables when comparing items, timelines, specs, scores, pros/cons — include a header row and align columns cleanly. Keep tables bounded (avoid 20+ rows); summarize very long sources instead.
- For direct excerpts from saved pages use blockquotes (> ) on their own lines, one short quote per cite. After substantive quotes attribute with a sentence or parentheses linking to URL from the segments.

SOURCES:
- Near the end, include a "## Sources" (or "### References") section: bullet list of URLs (and optional page titles) that were relied on — match the Segment URLs/titles provided.
- When stating a factual claim grounded in one segment's page, weave in the URL naturally or cite once in Sources.

CONTENT:
- Synthesize across all segments into one coherent narrative. Do NOT paste raw segment dumps unless as a brief blockquote illustration.
- If segments conflict, say so plainly and summarize the disagreement instead of hallucinating convergence.
- Write in clear, explanatory prose (neutral-professional tone). Do not apologize or meta-comment ("Here is your report").
`;

function getReportWriterLanguageModel(): LanguageModel | null {
  const explicit = process.env.REPORT_WRITER_MODEL?.trim();
  const provider =
    process.env.LLM_PROVIDER?.toLowerCase() === "anthropic"
      ? "anthropic"
      : "openai";
  const modelId =
    explicit ||
    process.env.AGENT_MODEL ||
    (provider === "anthropic" ? "claude-3-5-haiku-20241022" : "gpt-4o-mini");
  if (provider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) return null;
    return anthropic(modelId);
  }
  if (!process.env.OPENAI_API_KEY) return null;
  return openai(modelId);
}

function trimSegmentBody(body: string): string {
  if (body.length <= MAX_BODY_PER_SEGMENT) return body;
  return (
    body.slice(0, MAX_BODY_PER_SEGMENT) +
    `\n\n_[Body truncated at ${MAX_BODY_PER_SEGMENT} characters]_\n`
  );
}

export function extractTitleFromMarkdown(md: string): string {
  const line = md.split(/\r?\n/).find((l) => l.trim().length > 0);
  if (!line) return "Research report";
  const h1 = /^#\s+(.+)$/.exec(line.trim());
  if (h1) return h1[1].trim().slice(0, 200);
  return line.trim().slice(0, 200);
}

export async function generateResearchReportMarkdown(args: {
  goal: string;
  segments: ReportSegmentInput[];
  historyLines: readonly string[];
  signal: AbortSignal;
}): Promise<{ markdown: string; title: string }> {
  const model = getReportWriterLanguageModel();
  if (!model) {
    throw new Error("report_writer_no_model");
  }
  const trace =
    args.historyLines.length > 0
      ? args.historyLines.join("\n")
      : "(no action trace)";

  const segmentBlocks = args.segments
    .map((s) => {
      const b = trimSegmentBody(s.body);
      return [
        `### Segment ${s.index}`,
        `URL: ${s.url}`,
        `Page title: ${s.title}`,
        "",
        "```",
        b,
        "```",
      ].join("\n");
    })
    .join("\n\n---\n\n");

  const { text } = await generateText({
    model,
    system: REPORT_SYSTEM,
    abortSignal: args.signal,
    maxRetries: 1,
    maxOutputTokens: 8192,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `Original user task:`,
              args.goal,
              "",
              `Saved page content (${args.segments.length} segment(s)):`,
              segmentBlocks,
              "",
              `Optional action trace (recent, for context only):`,
              trace,
              "",
              "Write the full styled Markdown report now, following every OUTPUT and FORMATTING rule in your system prompt.",
            ].join("\n"),
          },
        ],
      },
    ],
  });

  const markdown = text.trim();
  if (!markdown) throw new Error("report_writer_empty_output");
  return {
    markdown,
    title: extractTitleFromMarkdown(markdown),
  };
}

export type ReportSegmentStored = { url: string; title: string; body: string };

export async function runResearchReportPipeline(args: {
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

