import { ElectronAPI } from "@electron-toolkit/preload";

interface ChatRequest {
  message: string;
  messageId: string;
  context?: {
    url: string | null;
    content: string | null;
    text: string | null;
  };
}

interface ChatResponse {
  messageId: string;
  content: string;
  isComplete: boolean;
}

interface TabInfo {
  id: string;
  title: string;
  url: string;
  isActive: boolean;
}

type AgentScreenshotResult =
  | { ok: true; dataUrl: string; url: string; title: string }
  | { ok: false; error: string };

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
  | { type: "step"; step: number; action: AgentStepAction }
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

interface Routine {
  id: string;
  name: string;
  query: string;
  createdAt: string;
}

interface SidebarAPI {
  sendChatMessage: (
    request: ChatRequest | Pick<ChatRequest, "message" | "messageId">
  ) => Promise<void>;
  clearChat: () => Promise<boolean>;
  getMessages: () => Promise<unknown[]>;

  onChatResponse: (callback: (data: ChatResponse) => void) => void;
  removeChatResponseListener: () => void;

  onMessagesUpdated: (callback: (messages: unknown[]) => void) => void;
  removeMessagesUpdatedListener: () => void;

  // Page content access
  getPageContent: () => Promise<string | null>;
  getPageText: () => Promise<string | null>;
  getCurrentUrl: () => Promise<string | null>;

  getActiveTabInfo: () => Promise<TabInfo | null>;

  captureAgentActiveTabScreenshot: () => Promise<AgentScreenshotResult>;

  agentStart: (
    goal: string,
    maxSteps?: number
  ) => Promise<{ ok: true } | { ok: false; error: string }>;

  agentStop: () => Promise<boolean>;

  mutateRun: (
    instruction: string
  ) => Promise<MutateRunResult>;

  openAgentReportTab: (
    reportId: string
  ) => Promise<
    | { ok: true; tabId: string; url: string; title: string }
    | { ok: false; error: string }
  >;

  onAgentEvent: (callback: (event: AgentEventPayload) => void) => void;
  removeAgentEventListener: () => void;

  onHomeAgentRun: (callback: (payload: HomeAgentRunPayload) => void) => void;
  removeHomeAgentRunListener: () => void;

  routinesGetAll: () => Promise<Routine[]>;
  routinesSave: (
    name: string,
    query: string,
  ) => Promise<{ ok: true; routine: Routine } | { ok: false; error: string }>;
  routinesDelete: (id: string) => Promise<{ ok: boolean }>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    sidebarAPI: SidebarAPI;
  }
}

