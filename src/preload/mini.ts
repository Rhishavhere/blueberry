import { contextBridge } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

const miniAPI = {
  enterMiniMode: () => electronAPI.ipcRenderer.invoke("enter-mini-mode"),
  exitMiniMode: () => electronAPI.ipcRenderer.invoke("exit-mini-mode"),
  quitApp: () => electronAPI.ipcRenderer.invoke("quit-app"),
  search: (url: string) => electronAPI.ipcRenderer.invoke("mini-search", url),
  collapse: () => electronAPI.ipcRenderer.invoke("mini-collapse"),
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("miniAPI", miniAPI);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore
  window.electron = electronAPI;
  // @ts-ignore
  window.miniAPI = miniAPI;
}
