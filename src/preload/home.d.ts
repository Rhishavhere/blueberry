import { ElectronAPI } from "@electron-toolkit/preload";

interface HomeAPI {
  navigateFromSearch: (url: string) => Promise<boolean>;
  openSidebarWithAgent: (request: {
    message: string;
    messageId: string;
  }) => Promise<boolean>;
  toggleSidebar: () => Promise<boolean>;
  listReports: () => Promise<Array<{ id: string; title: string; createdAt: string }>>;
  openReport: (id: string) => Promise<{ ok: boolean; tabId?: string; url?: string; title?: string; error?: string }>;
}

interface Routine {
  id: string;
  name: string;
  query: string;
  createdAt: string;
}

interface RoutinesAPI {
  getAll: () => Promise<Routine[]>;
  save: (
    name: string,
    query: string,
  ) => Promise<{ ok: true; routine: Routine } | { ok: false; error: string }>;
  delete: (id: string) => Promise<{ ok: boolean }>;
  updateSchedule: (
    id: string,
    schedule: {
      type: "daily" | "weekly" | "hourly";
      time?: string;
      dayOfWeek?: number;
      enabled: boolean;
    } | null
  ) => Promise<{ ok: boolean; routine?: Routine }>;
}

interface SavedReportPayload {
  id: string;
  title: string;
  markdown: string;
  createdAt: string;
}

interface ReportAPI {
  loadReport: (id: string) => Promise<SavedReportPayload | null>;
  saveReportAs: (
    id: string,
  ) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
  openGmailDraft: (
    subject: string,
    body: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    homeAPI: HomeAPI;
    reportAPI: ReportAPI;
    routinesAPI: RoutinesAPI;
  }
}
