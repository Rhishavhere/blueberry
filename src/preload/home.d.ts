import { ElectronAPI } from "@electron-toolkit/preload";

interface HomeAPI {
  navigateFromSearch: (url: string) => Promise<boolean>;
  openSidebarWithAgent: (request: {
    message: string;
    messageId: string;
  }) => Promise<boolean>;
  toggleSidebar: () => Promise<boolean>;
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
