import { contextBridge, ipcRenderer } from "electron";
import type {
  AuthResult,
  AuthUser,
  DownloadRecord,
  DownloadType,
  MediaInfo,
  ProgressPayload,
  UserLibrarySaveResult,
  UserLibrarySnapshot,
  UserPlaylist,
  YoutubeSearchResult
} from "../shared/types";

ipcRenderer.on("auth-session-expired", () => {
  window.dispatchEvent(new Event("auth-session-expired"));
});

const api = {
  authSession: (): Promise<{ user: AuthUser | null }> => ipcRenderer.invoke("auth:session"),
  authRegister: (payload: {
    username: string;
    password: string;
    passwordConfirmation: string;
    acceptedPasswordResponsibility: boolean;
  }): Promise<AuthResult> => ipcRenderer.invoke("auth:register", payload),
  authLogin: (payload: { username: string; password: string }): Promise<AuthResult> => ipcRenderer.invoke("auth:login", payload),
  authLogout: (): Promise<boolean> => ipcRenderer.invoke("auth:logout"),
  loadLibrary: (): Promise<UserLibrarySnapshot> => ipcRenderer.invoke("library:load"),
  saveLibrary: (playlists: UserPlaylist[], revision: number): Promise<UserLibrarySaveResult> =>
    ipcRenderer.invoke("library:save", playlists, revision),
  getMediaInfo: (url: string): Promise<MediaInfo> => ipcRenderer.invoke("media:info", url),
  searchMusic: (query: string): Promise<YoutubeSearchResult[]> => ipcRenderer.invoke("music:search", query),
  listDownloads: (): Promise<DownloadRecord[]> => ipcRenderer.invoke("downloads:list"),
  listDownloadHistory: (): Promise<DownloadRecord[]> => ipcRenderer.invoke("downloads:history"),
  downloadFile: (record: DownloadRecord): Promise<boolean> => ipcRenderer.invoke("files:save-copy", record),
  findCompleted: (url: string, type?: DownloadType): Promise<DownloadRecord | null> =>
    ipcRenderer.invoke("downloads:completed", url, type),
  startDownload: (url: string, type: DownloadType): Promise<{ idDownload: number; filePath: string }> =>
    ipcRenderer.invoke("downloads:start", url, type),
  playFile: (filePath: string): Promise<boolean> => ipcRenderer.invoke("files:play", filePath),
  onProgress: (callback: (payload: ProgressPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ProgressPayload) => callback(payload);
    ipcRenderer.on("download-progress", listener);
    return () => {
      ipcRenderer.removeListener("download-progress", listener);
    };
  }
};

contextBridge.exposeInMainWorld("esporteFai", api);

export type EsporteFaiApi = typeof api;
