import { contextBridge } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

interface ChatRequest {
  message: string;
  context: {
    url: string | null;
    content: string | null;
    text: string | null;
  };
  messageId: string;
}

interface ChatResponse {
  messageId: string;
  content: string;
  isComplete: boolean;
}

type AgentStepAction =
  | { action: "see" }
  | { action: "new_tab"; url?: string }
  | { action: "navigate"; url: string }
  | { action: "click_xy"; x: number; y: number }
  | { action: "type"; text: string }
  | { action: "press_enter" }
  | { action: "scroll"; deltaY: number }
  | { action: "wait"; ms: number }
  | {
      action: "read_page";
      maxChars?: number;
      includeHtml?: boolean;
    }
  | { action: "save_report"; includeHtml?: boolean }
  | { action: "done"; summary: string };

type AgentEventPayload =
  | { type: "log"; message: string }
  | {
      type: "step";
      step: number;
      action: AgentStepAction;
    }
  | { type: "conclusion"; text: string }
  | { type: "error"; message: string }
  | { type: "finished"; reason: string }
  | { type: "report_generating" }
  | { type: "report_error"; message: string }
  | { type: "report"; id: string; title: string; url: string };

type HomeAgentRunPayload = {
  goal: string;
  messageId: string;
};

type MutateRunResult =
  | {
      ok: true;
      message: string;
      js: string;
      executionResult: unknown;
    }
  | { ok: false; error: string };

// Sidebar specific APIs
const sidebarAPI = {
  // Chat functionality
  sendChatMessage: (request: Partial<ChatRequest>) =>
    electronAPI.ipcRenderer.invoke("sidebar-chat-message", request),

  clearChat: () => electronAPI.ipcRenderer.invoke("sidebar-clear-chat"),

  getMessages: () => electronAPI.ipcRenderer.invoke("sidebar-get-messages"),

  onChatResponse: (callback: (data: ChatResponse) => void) => {
    electronAPI.ipcRenderer.on("chat-response", (_, data) => callback(data));
  },

  onMessagesUpdated: (callback: (messages: unknown[]) => void) => {
    electronAPI.ipcRenderer.on("chat-messages-updated", (_, messages) =>
      callback(messages),
    );
  },

  removeChatResponseListener: () => {
    electronAPI.ipcRenderer.removeAllListeners("chat-response");
  },

  removeMessagesUpdatedListener: () => {
    electronAPI.ipcRenderer.removeAllListeners("chat-messages-updated");
  },

  // Page content access
  getPageContent: () => electronAPI.ipcRenderer.invoke("get-page-content"),
  getPageText: () => electronAPI.ipcRenderer.invoke("get-page-text"),
  getCurrentUrl: () => electronAPI.ipcRenderer.invoke("get-current-url"),

  // Tab information
  getActiveTabInfo: () => electronAPI.ipcRenderer.invoke("get-active-tab-info"),

  // Agent (v1): screenshot probe
  captureAgentActiveTabScreenshot: () =>
    electronAPI.ipcRenderer.invoke("agent-capture-active-tab"),

  agentStart: (goal: string, maxSteps?: number) =>
    electronAPI.ipcRenderer.invoke("agent-start", { goal, maxSteps }),

  agentStop: () => electronAPI.ipcRenderer.invoke("agent-stop"),

  mutateRun: (instruction: string): Promise<MutateRunResult> =>
    electronAPI.ipcRenderer.invoke("mutate-run", instruction),

  openAgentReportTab: (
    reportId: string,
  ): Promise<
    | { ok: true; tabId: string; url: string; title: string }
    | { ok: false; error: string }
  > => electronAPI.ipcRenderer.invoke("agent-open-report-tab", reportId),

  onAgentEvent: (callback: (data: AgentEventPayload) => void) => {
    electronAPI.ipcRenderer.on("agent-event", (_, data) => callback(data));
  },

  removeAgentEventListener: () => {
    electronAPI.ipcRenderer.removeAllListeners("agent-event");
  },

  onHomeAgentRun: (callback: (data: HomeAgentRunPayload) => void) => {
    electronAPI.ipcRenderer.on("home-agent-run", (_, data) => callback(data));
  },

  removeHomeAgentRunListener: () => {
    electronAPI.ipcRenderer.removeAllListeners("home-agent-run");
  },

  // Routines
  routinesGetAll: (): Promise<any[]> =>
    electronAPI.ipcRenderer.invoke("routines-get-all"),

  routinesSave: (
    name: string,
    query: string,
  ): Promise<{ ok: true; routine: any } | { ok: false; error: string }> =>
    electronAPI.ipcRenderer.invoke("routines-save", name, query),

  routinesDelete: (id: string): Promise<{ ok: boolean }> =>
    electronAPI.ipcRenderer.invoke("routines-delete", id),
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("sidebarAPI", sidebarAPI);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.sidebarAPI = sidebarAPI;
}
