import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

function isHomePage(): boolean {
  try {
    const h = window.location.href;
    if (h.startsWith("file:")) return /home[/\\]index\.html/i.test(h);
    const u = new URL(h);
    const p = u.pathname.replace(/\/+$/, "") || "/";
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
      return p === "/home";
    }
    return false;
  } catch {
    return false;
  }
}

function isReportPage(): boolean {
  try {
    const h = window.location.href;
    if (h.startsWith("file:")) return /report[/\\]index\.html/i.test(h);
    const u = new URL(h);
    const p = u.pathname.replace(/\/+$/, "") || "/";
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
      return p === "/report";
    }
    return false;
  } catch {
    return false;
  }
}

const homeAPI = {
  navigateFromSearch: (url: string) => {
    if (!isHomePage()) return Promise.resolve(false);
    return ipcRenderer.invoke("home-navigate", url) as Promise<boolean>;
  },
  openSidebarWithAgent: (request: { message: string; messageId: string }) => {
    if (!isHomePage()) return Promise.resolve(false);
    return ipcRenderer.invoke(
      "home-open-sidebar-with-agent",
      request,
    ) as Promise<boolean>;
  },
  toggleSidebar: () => ipcRenderer.invoke("toggle-sidebar"),
};

const reportAPI = {
  loadReport: (id: string) => {
    if (!isReportPage()) return Promise.resolve(null as null);
    return ipcRenderer.invoke("agent-report-get", id) as Promise<{
      id: string;
      title: string;
      markdown: string;
      createdAt: string;
    } | null>;
  },
  saveReportAs: (id: string) =>
    ipcRenderer.invoke("agent-report-save-as", id) as Promise<
      | { ok: true; path: string }
      | { ok: false; error: string }
    >,
  openGmailDraft: (subject: string, body: string) =>
    ipcRenderer.invoke("agent-report-gmail", { subject, body }) as Promise<
      { ok: true } | { ok: false; error: string }
    >,
};

const routinesAPI = {
  getAll: (): Promise<any[]> => ipcRenderer.invoke("routines-get-all"),
  save: (
    name: string,
    query: string,
  ): Promise<{ ok: true; routine: any } | { ok: false; error: string }> =>
    ipcRenderer.invoke("routines-save", name, query),
  delete: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("routines-delete", id),
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("homeAPI", homeAPI);
    contextBridge.exposeInMainWorld("reportAPI", reportAPI);
    contextBridge.exposeInMainWorld("routinesAPI", routinesAPI);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.homeAPI = homeAPI;
  // @ts-ignore (define in dts)
  window.reportAPI = reportAPI;
  // @ts-ignore (define in dts)
  window.routinesAPI = routinesAPI;
}
