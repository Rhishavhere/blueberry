import { is } from "@electron-toolkit/utils";
import { BaseWindow, WebContentsView } from "electron";
import { join } from "path";

const TOPBAR_HEIGHT = 88;
// const BAR_HEIGHT = 56;

/** Electron typing may lag newer WebContents APIs. */
function setWebContentsPassthroughIgnore(
  wc: WebContentsView["webContents"],
): void {
  type WcExtras = typeof wc & {
    setIgnoreMouseEvents?: (
      ignore: boolean,
      opts?: { forward?: boolean },
    ) => void;
  };
  (wc as WcExtras).setIgnoreMouseEvents?.(true, { forward: true });
}

function setWebContentsTransparentBg(
  wc: WebContentsView["webContents"],
  hex: string,
): void {
  type WcExtras = typeof wc & { setBackgroundColor?: (c: string) => void };
  (wc as WcExtras).setBackgroundColor?.(hex);
}

/**
 * Full-tab glow (click-through) + bottom bar (Stop) above page WebContentsViews.
 * Z-order: append glow then bar so the bar receives clicks.
 */
export class AgentChromeOverlay {
  private readonly baseWindow: BaseWindow;
  private readonly getSidebarWidth: () => number;
  private readonly glowView: WebContentsView;
  // private readonly barView: WebContentsView;
  private active = false;

  constructor(baseWindow: BaseWindow, getSidebarWidth: () => number) {
    this.baseWindow = baseWindow;
    this.getSidebarWidth = getSidebarWidth;
    this.glowView = this.createGlowView();
    // Bar overlay intentionally disabled for now (kept in code for quick restore).
    // this.barView = this.createBarView();
    baseWindow.contentView.addChildView(this.glowView);
    // baseWindow.contentView.addChildView(this.barView);
    this.placeFrames({ visible: false });
    this.armGlowPassthrough();

    baseWindow.once("closed", () => this.detachViews());
  }

  private detachViews(): void {
    try {
      this.baseWindow.contentView.removeChildView(this.glowView);
    } catch {
      /* noop */
    }
    try {
      // this.baseWindow.contentView.removeChildView(this.barView);
    } catch {
      /* noop */
    }
  }

  /** After each glow load/reload, clicks must pass through to the tab underneath. */
  private armGlowPassthrough(): void {
    const wc = this.glowView.webContents;
    const apply = (): void => {
      setWebContentsPassthroughIgnore(wc);
    };
    wc.on("did-finish-load", apply);
    if (!wc.isLoadingMainFrame()) {
      apply();
    }
  }

  private loadOverlayPage(
    view: WebContentsView,
    devPath: string,
    prodHtmlPathSegments: readonly string[],
  ): void {
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      const base = process.env["ELECTRON_RENDERER_URL"];
      const normalized = base.endsWith("/") ? base : `${base}/`;
      view.webContents.loadURL(new URL(devPath, normalized).href);
    } else {
      view.webContents.loadFile(
        join(__dirname, "../renderer/", ...prodHtmlPathSegments),
      );
    }
  }

  private createGlowView(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        transparent: true,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
    });
    setWebContentsTransparentBg(view.webContents, "#00000000");
    view.webContents.setAudioMuted(true);
    this.loadOverlayPage(view, "agent-overlay/glow/", [
      "agent-overlay",
      "glow",
      "index.html",
    ]);
    return view;
  }

  // private createBarView(): WebContentsView {
  //   const view = new WebContentsView({
  //     webPreferences: {
  //       preload: join(__dirname, "../preload/agentOverlay.js"),
  //       transparent: true,
  //       nodeIntegration: false,
  //       contextIsolation: true,
  //       sandbox: false,
  //     },
  //   });
  //   setWebContentsTransparentBg(view.webContents, "#00000000");
  //   view.webContents.setAudioMuted(true);
  //   this.loadOverlayPage(view, "agent-overlay/bar/", [
  //     "agent-overlay",
  //     "bar",
  //     "index.html",
  //   ]);
  //   return view;
  // }

  /** Keep overlays above newly created tab views. */
  raiseAboveTabs(): void {
    const cv = this.baseWindow.contentView;
    try {
      cv.removeChildView(this.glowView);
    } catch {
      /* not attached */
    }
    try {
      // cv.removeChildView(this.barView);
    } catch {
      /* not attached */
    }
    cv.addChildView(this.glowView);
    // cv.addChildView(this.barView);
    this.placeFrames({ visible: this.active });
  }

  /** Window resize / sidebar toggle — keep geometry in sync. */
  updateLayout(): void {
    this.placeFrames({ visible: this.active });
  }

  private placeFrames(args: { visible: boolean }): void {
    const { width: ww, height: wh } = this.baseWindow.getBounds();
    const sidebar = this.getSidebarWidth();
    const contentW = Math.max(0, ww - sidebar);
    const contentH = Math.max(0, wh - TOPBAR_HEIGHT);
    const x = 0;
    const y = TOPBAR_HEIGHT;

    if (!args.visible || contentW <= 0 || contentH <= 0) {
      this.glowView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      // this.barView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }

    this.glowView.setBounds({
      x,
      y,
      width: contentW,
      height: contentH,
    });
    // const barTop = Math.max(y, y + contentH - BAR_HEIGHT);
    // this.barView.setBounds({
    //   x,
    //   y: barTop,
    //   width: contentW,
    //   height: Math.min(BAR_HEIGHT, contentH),
    // });
  }

  setActive(on: boolean): void {
    this.active = on;
    if (on) {
      this.raiseAboveTabs();
      this.placeFrames({ visible: true });
      setWebContentsPassthroughIgnore(this.glowView.webContents);
    } else {
      this.placeFrames({ visible: false });
    }
  }
}
