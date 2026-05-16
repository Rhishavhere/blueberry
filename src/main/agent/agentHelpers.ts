import { generateText, type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";

export function getAgentLanguageModel(): LanguageModel | null {
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

export async function writeUserConclusion(args: {
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
  const prompt = [
    `You are the "user interface" handler for an autonomous agent.`,
    `The agent has just declared it is "done" with its goal.`,
    `Goal: ${goal}`,
    `Agent's own final summary: ${agentDoneSummary}`,
    `Below is the complete execution history lines (JSON steps).`,
    `---`,
    ...historyLines,
    `---`,
    `Your job is to write a short, friendly, readable concluding sentence or paragraph for the USER.`,
    `Tell them what was found or achieved at a high level. Use a helpful, human tone. Do not mention technical step details or JSON.`,
    `Output ONLY the concluding text.`,
  ].join("\n");

  try {
    const { text } = await generateText({
      model,
      prompt,
      abortSignal: signal,
      maxOutputTokens: 500,
    });
    return text.trim();
  } catch (err) {
    console.error("Error generating clean user conclusion:", err);
    return `${agentDoneSummary}`;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
