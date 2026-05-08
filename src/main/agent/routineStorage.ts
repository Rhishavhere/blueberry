import { app } from "electron";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

export interface Routine {
  id: string;
  name: string;
  query: string;
  createdAt: string;
  schedule?: {
    type: "daily" | "weekly" | "hourly";
    time?: string; // HH:MM for daily/weekly
    dayOfWeek?: number; // 0-6 for weekly
    enabled: boolean;
  };
  lastRun?: string; // ISO timestamp
  nextRun?: string; // ISO timestamp
}

function routinesFilePath(): string {
  const dir = join(app.getPath("userData"), "blewberry");
  return join(dir, "routines.json");
}

async function ensureDir(): Promise<void> {
  const dir = join(app.getPath("userData"), "blewberry");
  await mkdir(dir, { recursive: true });
}

export async function loadRoutines(): Promise<Routine[]> {
  try {
    const raw = await readFile(routinesFilePath(), "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as Routine[];
    return [];
  } catch {
    return [];
  }
}

async function saveRoutines(routines: Routine[]): Promise<void> {
  await ensureDir();
  await writeFile(routinesFilePath(), JSON.stringify(routines, null, 2), "utf-8");
}

export async function addRoutine(name: string, query: string): Promise<Routine> {
  const routines = await loadRoutines();
  const routine: Routine = {
    id: crypto.randomUUID(),
    name: name.trim(),
    query: query.trim(),
    createdAt: new Date().toISOString(),
  };
  routines.push(routine);
  await saveRoutines(routines);
  return routine;
}

export async function deleteRoutine(id: string): Promise<boolean> {
  const routines = await loadRoutines();
  const filtered = routines.filter((r) => r.id !== id);
  if (filtered.length === routines.length) return false;
  await saveRoutines(filtered);
  return true;
}

export async function updateRoutine(id: string, updates: Partial<Routine>): Promise<Routine | null> {
  const routines = await loadRoutines();
  const idx = routines.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  
  routines[idx] = { ...routines[idx], ...updates };
  await saveRoutines(routines);
  return routines[idx];
}
