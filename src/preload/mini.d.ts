import { ElectronAPI } from "@electron-toolkit/preload";

interface MiniAPI {
  enterMiniMode: () => Promise<boolean>;
  exitMiniMode: () => Promise<boolean>;
  quitApp: () => Promise<boolean>;
  search: (url: string) => Promise<boolean>;
  collapse: () => Promise<boolean>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    miniAPI: MiniAPI;
  }
}
