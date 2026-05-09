import { BaseWindow, WebContentsView } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";

export class MiniWindow {
  private baseWindow: BaseWindow;
  private uiView: WebContentsView;
  private isExpanded: boolean = false;
  private readonly defaultWidth = 800;
  private readonly defaultHeight = 60;
  private readonly expandedHeight = 600;

  private getWindowIconPath(): string | undefined {
    if (process.platform !== "win32") {
      return undefined;
    }
    return process.env.NODE_ENV === "development"
      ? join(process.cwd(), "resources", "icon.ico")
      : join(process.resourcesPath, "resources", "icon.ico");
  }

  constructor() {
    this.baseWindow = new BaseWindow({
      width: this.defaultWidth,
      height: this.defaultHeight,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      alwaysOnTop: false,
      resizable: false,
      skipTaskbar: false,
      ...(this.getWindowIconPath() ? { icon: this.getWindowIconPath() } : {}),
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
        webviewTag: true, // Enable <webview> in the React renderer
      },
    });

    // Make the view background transparent so CSS transparency works
    view.setBackgroundColor('#00000000');

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
    // uiView always fills the entire baseWindow
    this.uiView.setBounds({
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height,
    });
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
  }

  public expandLow(): void {
    this.isExpanded = true;
    
    const bounds = this.baseWindow.getBounds();
    this.baseWindow.setBounds({
      ...bounds,
      height: 300, // Low expanded view height
    });

    this.updateBounds();
  }

  public expandFull(): void {
    this.isExpanded = true;
    
    const bounds = this.baseWindow.getBounds();
    this.baseWindow.setBounds({
      ...bounds,
      height: this.expandedHeight,
    });

    this.updateBounds();
  }

  public expandProactiveResult(): void {
    this.isExpanded = true;
    
    const { screen } = require("electron");
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width } = primaryDisplay.workAreaSize;
    
    const newWidth = 1200;
    const newHeight = 700;
    
    this.baseWindow.setBounds({
      x: Math.round(width / 2 - newWidth / 2),
      y: 20,
      width: newWidth,
      height: newHeight,
    });

    this.updateBounds();
  }

  public collapse(): void {
    this.isExpanded = false;
    
    const { screen } = require("electron");
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width } = primaryDisplay.workAreaSize;
    
    this.baseWindow.setBounds({
      x: Math.round(width / 2 - this.defaultWidth / 2),
      y: 20,
      width: this.defaultWidth,
      height: this.defaultHeight,
    });

    this.updateBounds();
  }

  public get window(): BaseWindow {
    return this.baseWindow;
  }

  public get view(): WebContentsView {
    return this.uiView;
  }

  public get isWindowExpanded(): boolean {
    return this.isExpanded;
  }

  public destroy(): void {
    this.baseWindow.close();
  }
}
