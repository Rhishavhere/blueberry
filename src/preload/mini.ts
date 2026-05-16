import { contextBridge } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import { join } from "path";
import { pathToFileURL } from "url";

const miniAPI = {
  enterMiniMode: () => electronAPI.ipcRenderer.invoke("enter-mini-mode"),
  exitMiniMode: (url?: string) => electronAPI.ipcRenderer.invoke("exit-mini-mode", url),
  quitApp: () => electronAPI.ipcRenderer.invoke("quit-app"),
  search: () => electronAPI.ipcRenderer.invoke("mini-search"),
  collapse: () => electronAPI.ipcRenderer.invoke("mini-collapse"),
  expandFull: () => electronAPI.ipcRenderer.invoke("mini-expand-full"),
  startHeadlessAgent: (goal: string) => electronAPI.ipcRenderer.invoke("headless-agent-start", goal),
  stopHeadlessAgent: () => electronAPI.ipcRenderer.invoke("headless-agent-stop"),
  onAgentEvent: (callback: (event: any) => void) => {
    electronAPI.ipcRenderer.on("headless-agent-event", (_, event) => callback(event));
    return () => electronAPI.ipcRenderer.removeAllListeners("headless-agent-event");
  },
  getHomePreloadPath: () => {
    return pathToFileURL(join(__dirname, "home.js")).href;
  },
};

const reportAPI = {
  loadReport: (id: string) => {
    return electronAPI.ipcRenderer.invoke("mini-agent-report-get", id) as Promise<any>;
  },
  saveReportAs: (id: string) =>
    electronAPI.ipcRenderer.invoke("mini-agent-report-save-as", id) as Promise<any>,
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("miniAPI", miniAPI);
    contextBridge.exposeInMainWorld("reportAPI", reportAPI);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore
  window.electron = electronAPI;
  // @ts-ignore
  window.miniAPI = miniAPI;
  // @ts-ignore
  window.reportAPI = reportAPI;
}
