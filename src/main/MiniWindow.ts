import { BaseWindow, WebContentsView } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { Tab } from "./Tab";

export class MiniWindow {
  private baseWindow: BaseWindow;
  private uiView: WebContentsView;
  private resultTab: Tab | null = null;
  private isExpanded: boolean = false;
  private readonly defaultWidth = 600;
  private readonly defaultHeight = 80;
  private readonly expandedHeight = 600;

  constructor() {
    this.baseWindow = new BaseWindow({
      width: this.defaultWidth,
      height: this.defaultHeight,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: false,
    });

    // Center at the top of the screen
    const { screen } = require("electron");
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width } = primaryDisplay.workAreaSize;
    
    this.baseWindow.setBounds({
      x: Math.round(width / 2 - this.defaultWidth / 2),
      y: 20, // slightly off the top
      width: this.defaultWidth,
      height: this.defaultHeight,
    });

    this.uiView = this.createUiView();
    this.baseWindow.contentView.addChildView(this.uiView);
    
    this.updateBounds();
  }

  private createUiView(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, "../preload/mini.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
    });

    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      const miniUrl = new URL("/mini/", process.env["ELECTRON_RENDERER_URL"]);
      view.webContents.loadURL(miniUrl.toString());
    } else {
      view.webContents.loadFile(join(__dirname, "../renderer/mini.html"));
    }

    return view;
  }

  private updateBounds(): void {
    const bounds = this.baseWindow.getBounds();
    this.uiView.setBounds({
      x: 0,
      y: 0,
      width: bounds.width,
      height: this.defaultHeight, // UI is always 60px high at the top
    });

    if (this.isExpanded && this.resultTab) {
      this.resultTab.view.setBounds({
        x: 0,
        y: this.defaultHeight,
        width: bounds.width,
        height: bounds.height - this.defaultHeight,
      });
    }
  }

  public show(): void {
    this.baseWindow.show();
    // Re-center just in case resolution changed
    const { screen } = require("electron");
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width } = primaryDisplay.workAreaSize;
    
    const bounds = this.baseWindow.getBounds();
    this.baseWindow.setBounds({
      x: Math.round(width / 2 - this.defaultWidth / 2),
      y: 20,
      width: this.defaultWidth,
      height: bounds.height,
    });
  }

  public hide(): void {
    this.baseWindow.hide();
    this.collapse(); // always collapse when hiding
  }

  public async expandAndSearch(url: string): Promise<void> {
    this.isExpanded = true;
    
    const bounds = this.baseWindow.getBounds();
    this.baseWindow.setBounds({
      ...bounds,
      height: this.expandedHeight,
    });

    if (!this.resultTab) {
      this.resultTab = new Tab("mini-tab-1", url);
      this.baseWindow.contentView.addChildView(this.resultTab.view);
    } else {
      await this.resultTab.loadURL(url);
    }

    this.updateBounds();
  }

  public collapse(): void {
    this.isExpanded = false;
    
    const bounds = this.baseWindow.getBounds();
    this.baseWindow.setBounds({
      ...bounds,
      height: this.defaultHeight,
    });

    if (this.resultTab) {
      this.baseWindow.contentView.removeChildView(this.resultTab.view);
      this.resultTab.destroy();
      this.resultTab = null;
    }

    this.updateBounds();
  }

  public get isWindowExpanded(): boolean {
    return this.isExpanded;
  }

  public get currentUrl(): string | null {
    return this.resultTab ? this.resultTab.url : null;
  }

  public destroy(): void {
    if (this.resultTab) {
      this.resultTab.destroy();
    }
    this.baseWindow.close();
  }
}
