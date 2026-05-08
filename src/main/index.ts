import { app, BrowserWindow } from "electron";
import { electronApp } from "@electron-toolkit/utils";
import { Window } from "./Window";
import { MiniWindow } from "./MiniWindow";
import { AppMenu } from "./Menu";
import { EventManager } from "./EventManager";
import { scheduler } from "./agent/scheduler";

let mainWindow: Window | null = null;
let miniWindow: MiniWindow | null = null;
let eventManager: EventManager | null = null;
let menu: AppMenu | null = null;

const createWindow = (): Window => {
  const window = new Window();
  miniWindow = new MiniWindow();
  menu = new AppMenu(window);
  eventManager = new EventManager(window, miniWindow);
  return window;
};
app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.electron");

  mainWindow = createWindow();
  
  // Start the routine scheduler
  scheduler.start();

  // The miniWindow stays alive in the background, which prevents 'window-all-closed'
  // from firing. We should explicitly quit the app when the main window is closed.
  mainWindow.window.on("closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (eventManager) {
    eventManager.cleanup();
    eventManager = null;
  }

  // Clean up references
  if (mainWindow) {
    mainWindow = null;
  }
  if (menu) {
    menu = null;
  }

  if (process.platform !== "darwin") {
    app.quit();
  }
});
