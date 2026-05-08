import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { app } from "electron";
import { randomUUID } from "crypto";
import { getReportViewerPageUrl } from "../reportPage";

const MAX_MARKDOWN_CHARS = 500_000;

export type SavedAgentReport = {
  id: string;
  title: string;
  markdown: string;
  createdAt: string;
};

function reportsDir(): string {
  return join(app.getPath("userData"), "agent-reports");
}

function reportPath(id: string): string {
  return join(reportsDir(), `${id}.json`);
}

export async function saveAgentReport(args: {
  title: string;
  markdown: string;
}): Promise<{ id: string; viewerUrl: string }> {
  await mkdir(reportsDir(), { recursive: true });
  const id = randomUUID();
  let md = args.markdown;
  if (md.length > MAX_MARKDOWN_CHARS) {
    md =
      md.slice(0, MAX_MARKDOWN_CHARS) +
      `\n\n_[Truncated at ${MAX_MARKDOWN_CHARS} characters]_\n`;
  }
  const title = args.title.trim().slice(0, 200) || "Research report";
  const payload: SavedAgentReport = {
    id,
    title,
    markdown: md,
    createdAt: new Date().toISOString(),
  };
  await writeFile(reportPath(id), JSON.stringify(payload), "utf-8");
  return { id, viewerUrl: getReportViewerPageUrl(id) };
}

export async function loadAgentReport(
  id: string,
): Promise<SavedAgentReport | null> {
  const safe = /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  if (!safe) return null;
  try {
    const raw = await readFile(reportPath(safe), "utf-8");
    const data = JSON.parse(raw) as SavedAgentReport;
    if (
      typeof data?.markdown === "string" &&
      typeof data?.title === "string" &&
      data.id === safe
    ) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

export async function listAgentReports(): Promise<Omit<SavedAgentReport, "markdown">[]> {
  const fs = await import("fs/promises");
  try {
    await fs.mkdir(reportsDir(), { recursive: true });
    const files = await fs.readdir(reportsDir());
    const reports: Omit<SavedAgentReport, "markdown">[] = [];
    
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(join(reportsDir(), file), "utf-8");
        const data = JSON.parse(raw) as SavedAgentReport;
        if (data && data.id && data.title) {
          reports.push({
            id: data.id,
            title: data.title,
            createdAt: data.createdAt || "",
          });
        }
      } catch {
        // ignore bad files
      }
    }
    
    // Sort by newest first
    return reports.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return [];
  }
}
