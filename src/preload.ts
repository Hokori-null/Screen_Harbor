import { contextBridge, ipcRenderer } from "electron";
import type { API, Event } from "./shared";
const api: API = {
  call: (method, args) => ipcRenderer.invoke("screen:call", method, args),
  onEvent: (fn) => {
    const listener = (_: unknown, event: Event) => fn(event);
    ipcRenderer.on("screen:event", listener);
    return () => ipcRenderer.removeListener("screen:event", listener);
  },
};
contextBridge.exposeInMainWorld("screenAPI", api);
