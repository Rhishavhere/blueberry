import { app, dialog, ipcMain, shell, WebContents } from "electron";
import { writeFile } from "fs/promises";
import type { Window } from "./Window";
import type { MiniWindow } from "./MiniWindow";
import { isHomePageUrl } from "./homePage";
import { getReportViewerPageUrl, isReportPageUrl } from "./reportPage";
import { loadAgentReport } from "./agent/agentReportStorage";
import { runPageMutation } from "./agent/mutateRunner";
import { AgentRunner } from "./AgentRunner";
import { HeadlessAgent } from "./agent/headlessAgent";
import { Tab } from "./Tab";
import { loadRoutines, addRoutine, deleteRoutine } from "./agent/routineStorage";

export class EventManager {
  private mainWindow: Window;
  private miniWindow: MiniWindow;
  private agentRunner = new AgentRunner();
  private currentHeadlessAgent: HeadlessAgent | null = null;

  constructor(mainWindow: Window, miniWindow: MiniWindow) {
    this.mainWindow = mainWindow;
    this.miniWindow = miniWindow;
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Tab management events
    this.handleTabEvents();

    // Sidebar events
    this.handleSidebarEvents();

    // Page content events
    this.handlePageContentEvents();

    // Dark mode events
    this.handleDarkModeEvents();

    // Debug events
    this.handleDebugEvents();

    // Mini mode events
    this.handleMiniModeEvents();

    // Routine events
    this.handleRoutineEvents();
  }

  private handleTabEvents(): void {
    // Create new tab
    ipcMain.handle("create-tab", (_, url?: string) => {
      const newTab = this.mainWindow.createTab(url);
      return { id: newTab.id, title: newTab.title, url: newTab.url };
    });

    // Close tab
    ipcMain.handle("close-tab", (_, id: string) => {
      this.mainWindow.closeTab(id);
    });

    // Switch tab
    ipcMain.handle("switch-tab", (_, id: string) => {
      this.mainWindow.switchActiveTab(id);
    });

    // Get tabs
    ipcMain.handle("get-tabs", () => {
      const activeTabId = this.mainWindow.activeTab?.id;
      return this.mainWindow.allTabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        isActive: activeTabId === tab.id,
      }));
    });

    // Navigation (for compatibility with existing code)
    ipcMain.handle("navigate-to", (_, url: string) => {
      if (this.mainWindow.activeTab) {
        this.mainWindow.activeTab.loadURL(url);
      }
    });

    ipcMain.handle("navigate-tab", async (_, tabId: string, url: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        await tab.loadURL(url);
        return true;
      }
      return false;
    });

    ipcMain.handle("go-back", () => {
      if (this.mainWindow.activeTab) {
        this.mainWindow.activeTab.goBack();
      }
    });

    ipcMain.handle("go-forward", () => {
      if (this.mainWindow.activeTab) {
        this.mainWindow.activeTab.goForward();
      }
    });

    ipcMain.handle("reload", () => {
      if (this.mainWindow.activeTab) {
        this.mainWindow.activeTab.reload();
      }
    });

    // Tab-specific navigation handlers
    ipcMain.handle("tab-go-back", (_, tabId: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        tab.goBack();
        return true;
      }
      return false;
    });

    ipcMain.handle("tab-go-forward", (_, tabId: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        tab.goForward();
        return true;
      }
      return false;
    });

    ipcMain.handle("tab-reload", (_, tabId: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        tab.reload();
        return true;
      }
      return false;
    });

    ipcMain.handle("tab-screenshot", async (_, tabId: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        const image = await tab.screenshot();
        return image.toDataURL();
      }
      return null;
    });

    ipcMain.handle("tab-run-js", async (_, tabId: string, code: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        return await tab.runJs(code);
      }
      return null;
    });

    ipcMain.handle("home-navigate", async (event, url: string) => {
      if (!isHomePageUrl(event.sender.getURL())) return false;
      const target = typeof url === "string" ? url.trim() : "";
      if (!target || /^\s*javascript:/i.test(target)) return false;
      for (const tab of this.mainWindow.allTabs) {
        if (tab.webContents === event.sender) {
          await tab.loadURL(url);
          return true;
        }
      }
      return false;
    });

    // Tab info
    ipcMain.handle("get-active-tab-info", () => {
      const activeTab = this.mainWindow.activeTab;
      if (activeTab) {
        return {
          id: activeTab.id,
          url: activeTab.url,
          title: activeTab.title,
          canGoBack: activeTab.webContents.canGoBack(),
          canGoForward: activeTab.webContents.canGoForward(),
        };
      }
      return null;
    });
  }

  private handleSidebarEvents(): void {
    // Toggle sidebar
    ipcMain.handle("toggle-sidebar", () => {
      this.mainWindow.sidebar.toggle();
      this.mainWindow.updateAllBounds();
      return true;
    });

    // Home (Agent pill): show sidebar and open Agent panel with goal
    ipcMain.handle(
      "home-open-sidebar-with-agent",
      async (event, request: { message: string; messageId: string }) => {
        if (!isHomePageUrl(event.sender.getURL())) return false;
        const text = request?.message?.trim() ?? "";
        if (!text) return false;

        if (!this.mainWindow.sidebar.getIsVisible()) {
          this.mainWindow.sidebar.show();
          this.mainWindow.updateAllBounds();
        }

        this.mainWindow.sidebar.view.webContents.focus();
        this.mainWindow.sidebar.view.webContents.send("home-agent-run", {
          goal: text,
          messageId: request.messageId,
        });
        return true;
      },
    );

    // Chat message
    ipcMain.handle("sidebar-chat-message", async (_, request) => {
      await this.mainWindow.sidebar.client.sendChatMessage(request);
    });

    // Clear chat
    ipcMain.handle("sidebar-clear-chat", () => {
      this.mainWindow.sidebar.client.clearMessages();
      return true;
    });

    // Get messages
    ipcMain.handle("sidebar-get-messages", () => {
      return this.mainWindow.sidebar.client.getMessages();
    });

    // Agent v1: screenshot of the active tab only (path to vision / see tool next)
    ipcMain.handle("agent-capture-active-tab", async () => {
      const tab = this.mainWindow.activeTab;
      if (!tab) {
        return { ok: false as const, error: "no_active_tab" };
      }
      try {
        const image = await tab.screenshot();
        return {
          ok: true as const,
          dataUrl: image.toDataURL(),
          url: tab.url,
          title: tab.title,
        };
      } catch (e) {
        return { ok: false as const, error: String(e) };
      }
    });

    ipcMain.handle(
      "agent-start",
      async (
        _,
        payload: { goal: string; maxSteps?: number },
      ): Promise<{ ok: true } | { ok: false; error: string }> => {
        const goal =
          typeof payload?.goal === "string" ? payload.goal.trim() : "";
        if (!goal) return { ok: false, error: "empty_goal" };

        this.agentRunner.stop();
        const sidebarWc = this.mainWindow.sidebar.view.webContents;

        this.mainWindow.setAgentOverlayActive(true);

        void this.agentRunner
          .run({
            goal,
            maxSteps:
              typeof payload?.maxSteps === "number" && payload.maxSteps > 0
                ? Math.min(payload.maxSteps, 60)
                : 60,
            getActiveTab: () => this.mainWindow.activeTab,
            createTabAndActivate: (url?: string) => {
              const t = this.mainWindow.createTab(url);
              this.mainWindow.switchActiveTab(t.id);
              return t;
            },
            emit: (event) => sidebarWc.send("agent-event", event),
          })
          .finally(() => {
            this.mainWindow.setAgentOverlayActive(false);
            this.mainWindow.focusActiveTabContents();
          });

        return { ok: true };
      },
    );

    ipcMain.handle("agent-stop", () => {
      this.agentRunner.stop();
      this.mainWindow.setAgentOverlayActive(false);
      this.mainWindow.focusActiveTabContents();
      return true;
    });

    ipcMain.handle("mutate-run", async (_, instruction: unknown) => {
      const trimmed = String(instruction ?? "").trim();
      if (!trimmed) {
        return { ok: false as const, error: "empty_mutate_instruction" };
      }
      const tab = this.mainWindow.activeTab;
      if (!tab) {
        return { ok: false as const, error: "no_active_tab" };
      }
      if (isHomePageUrl(tab.url)) {
        return { ok: false as const, error: "mutate_unsupported_home" };
      }
      if (isReportPageUrl(tab.url)) {
        return { ok: false as const, error: "mutate_unsupported_report" };
      }
      return runPageMutation({ tab, instruction: trimmed });
    });

    ipcMain.handle("agent-report-get", async (event, id: string) => {
      const url = event.sender.getURL();
      if (!isReportPageUrl(url)) return null;
      return loadAgentReport(String(id ?? "").trim());
    });

    ipcMain.handle("mini-agent-report-get", async (_, id: string) => {
      return loadAgentReport(String(id ?? "").trim());
    });

    ipcMain.handle("agent-open-report-tab", async (_, id: string) => {
      const safe = String(id ?? "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(safe)) {
        return { ok: false as const, error: "bad_id" };
      }
      const data = await loadAgentReport(safe);
      if (!data) return { ok: false as const, error: "not_found" };
      const viewerUrl = getReportViewerPageUrl(safe);
      const t = this.mainWindow.createTab(viewerUrl);
      this.mainWindow.switchActiveTab(t.id);
      return {
        ok: true as const,
        tabId: t.id,
        url: viewerUrl,
        title: data.title,
      };
    });

    ipcMain.handle("agent-report-save-as", async (event, id: string) => {
      if (!isReportPageUrl(event.sender.getURL())) {
        return { ok: false as const, error: "bad_context" };
      }
      const safe = String(id ?? "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(safe)) {
        return { ok: false as const, error: "bad_id" };
      }
      const data = await loadAgentReport(safe);
      if (!data) return { ok: false as const, error: "not_found" };
      const safeName =
        data.title
          .replace(/[<>:"/\\|?*]/g, "_")
          .trim()
          .slice(0, 80) || "report";
      const result = await dialog.showSaveDialog(this.mainWindow.window, {
        defaultPath: `${safeName}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (result.canceled || !result.filePath) {
        return { ok: false as const, error: "cancelled" };
      }
      await writeFile(result.filePath, data.markdown, "utf-8");
      return { ok: true as const, path: result.filePath };
    });

    ipcMain.handle("mini-agent-report-save-as", async (_, id: string) => {
      const safe = String(id ?? "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(safe)) {
        return { ok: false as const, error: "bad_id" };
      }
      const data = await loadAgentReport(safe);
      if (!data) return { ok: false as const, error: "not_found" };
      const safeName =
        data.title
          .replace(/[<>:"/\\|?*]/g, "_")
          .trim()
          .slice(0, 80) || "report";
      const result = await dialog.showSaveDialog(this.miniWindow.window, {
        defaultPath: `${safeName}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (result.canceled || !result.filePath) {
        return { ok: false as const, error: "cancelled" };
      }
      await writeFile(result.filePath, data.markdown, "utf-8");
      return { ok: true as const, path: result.filePath };
    });

    ipcMain.handle(
      "agent-report-gmail",
      async (event, payload: { subject: string; body: string }) => {
        if (!isReportPageUrl(event.sender.getURL())) {
          return { ok: false as const, error: "bad_context" };
        }
        const su = encodeURIComponent(payload.subject ?? "");
        const body = encodeURIComponent((payload.body ?? "").slice(0, 2_000));
        const url = `https://mail.google.com/mail/?view=cm&fs=1&su=${su}&body=${body}`;
        await shell.openExternal(url);
        return { ok: true as const };
      },
    );
  }

  private handlePageContentEvents(): void {
    // Get page content
    ipcMain.handle("get-page-content", async () => {
      if (this.mainWindow.activeTab) {
        try {
          return await this.mainWindow.activeTab.getTabHtml();
        } catch (error) {
          console.error("Error getting page content:", error);
          return null;
        }
      }
      return null;
    });

    // Get page text
    ipcMain.handle("get-page-text", async () => {
      if (this.mainWindow.activeTab) {
        try {
          return await this.mainWindow.activeTab.getTabText();
        } catch (error) {
          console.error("Error getting page text:", error);
          return null;
        }
      }
      return null;
    });

    // Get current URL
    ipcMain.handle("get-current-url", () => {
      if (this.mainWindow.activeTab) {
        return this.mainWindow.activeTab.url;
      }
      return null;
    });
  }

  private handleDarkModeEvents(): void {
    // Dark mode broadcasting
    ipcMain.on("dark-mode-changed", (event, isDarkMode) => {
      this.broadcastDarkMode(event.sender, isDarkMode);
    });
  }

  private handleDebugEvents(): void {
    // Ping test
    ipcMain.on("ping", () => console.log("pong"));
  }

  private handleMiniModeEvents(): void {
    ipcMain.handle("enter-mini-mode", () => {
      this.mainWindow.hide();
      this.miniWindow.show();
      return true;
    });

    ipcMain.handle("exit-mini-mode", async (_, urlFromReact?: string) => {
      this.miniWindow.hide();
      this.mainWindow.show();
      
      // Transfer URL if we have one
      if (urlFromReact) {
        let tab = this.mainWindow.activeTab;
        if (!tab) {
          tab = this.mainWindow.createTab(urlFromReact);
          this.mainWindow.switchActiveTab(tab.id);
        } else {
          await tab.loadURL(urlFromReact);
        }
      }
      return true;
    });

    ipcMain.handle("mini-search", async () => {
      this.miniWindow.expandFull();
      return true;
    });

    ipcMain.handle("mini-expand-full", () => {
      this.miniWindow.expandFull();
      return true;
    });

    ipcMain.handle("headless-agent-start", async (event, goal: string) => {
      this.miniWindow.expandLow();
      const headlessTab = new Tab("headless-" + Date.now(), "about:blank");
      this.currentHeadlessAgent = new HeadlessAgent();
      const agent = this.currentHeadlessAgent;
      const sender = event.sender;
      
      agent.run({
        goal,
        hiddenTab: headlessTab,
        emit: (agentEvent) => {
          sender.send("headless-agent-event", agentEvent);
        }
      }).finally(() => {
        headlessTab.destroy();
        if (this.currentHeadlessAgent === agent) {
          this.currentHeadlessAgent = null;
        }
      });
      return true;
    });

    ipcMain.handle("headless-agent-stop", () => {
      if (this.currentHeadlessAgent) {
        this.currentHeadlessAgent.stop();
        this.currentHeadlessAgent = null;
      }
      return true;
    });

    ipcMain.handle("mini-collapse", () => {
      this.miniWindow.collapse();
      return true;
    });

    ipcMain.handle("quit-app", () => {
      app.quit();
      return true;
    });
  }

  private broadcastDarkMode(sender: WebContents, isDarkMode: boolean): void {
    // Send to topbar
    if (this.mainWindow.topBar.view.webContents !== sender) {
      this.mainWindow.topBar.view.webContents.send(
        "dark-mode-updated",
        isDarkMode,
      );
    }

    // Send to sidebar
    if (this.mainWindow.sidebar.view.webContents !== sender) {
      this.mainWindow.sidebar.view.webContents.send(
        "dark-mode-updated",
        isDarkMode,
      );
    }

    // Send to all tabs
    this.mainWindow.allTabs.forEach((tab) => {
      if (tab.webContents !== sender) {
        tab.webContents.send("dark-mode-updated", isDarkMode);
      }
    });
  }

  private handleRoutineEvents(): void {
    ipcMain.handle("routines-get-all", async () => {
      return loadRoutines();
    });

    ipcMain.handle(
      "routines-save",
      async (_, name: string, query: string) => {
        const trimmedName = String(name ?? "").trim();
        const trimmedQuery = String(query ?? "").trim();
        if (!trimmedName || !trimmedQuery)
          return { ok: false as const, error: "empty_fields" };
        const routine = await addRoutine(trimmedName, trimmedQuery);
        return { ok: true as const, routine };
      },
    );

    ipcMain.handle("routines-delete", async (_, id: string) => {
      const ok = await deleteRoutine(String(id ?? "").trim());
      return { ok };
    });
  }

  // Clean up event listeners
  public cleanup(): void {
    ipcMain.removeAllListeners();
  }
}
