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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof body === "object" && body && "error" in body ? String(body.error) : String(body);
    if (response.status === 401 && !url.startsWith("/api/auth/")) {
      window.dispatchEvent(new Event("auth-session-expired"));
    }
    throw new ApiError(message || "Request failed.", response.status);
  }
  return body as T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const api = {
  authSession(): Promise<{ user: AuthUser | null }> {
    if (window.esporteFai) return window.esporteFai.authSession();
    return request("/api/auth/session");
  },
  authRegister(payload: {
    username: string;
    password: string;
    passwordConfirmation: string;
    acceptedPasswordResponsibility: boolean;
  }): Promise<AuthResult> {
    if (window.esporteFai) return window.esporteFai.authRegister(payload);
    return request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  },
  authLogin(payload: { username: string; password: string }): Promise<AuthResult> {
    if (window.esporteFai) return window.esporteFai.authLogin(payload);
    return request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  },
  async authLogout(): Promise<void> {
    if (window.esporteFai) {
      await window.esporteFai.authLogout();
      return;
    }
    await request("/api/auth/logout", { method: "POST" });
  },
  loadLibrary(): Promise<UserLibrarySnapshot> {
    if (window.esporteFai) return window.esporteFai.loadLibrary();
    return request("/api/library");
  },
  async saveLibrary(playlists: UserPlaylist[], revision: number): Promise<UserLibrarySaveResult> {
    if (window.esporteFai) {
      return window.esporteFai.saveLibrary(playlists, revision);
    }
    const response = await fetch("/api/library", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playlists, revision })
    });
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json") ? await response.json() : await response.text();
    if (response.ok || (response.status === 409 && isLibrarySaveResult(body))) {
      return body as UserLibrarySaveResult;
    }
    const message = typeof body === "object" && body && "error" in body ? String(body.error) : String(body);
    if (response.status === 401) window.dispatchEvent(new Event("auth-session-expired"));
    throw new ApiError(message || "Nao foi possivel salvar a biblioteca.", response.status);
  },
  getMediaInfo(url: string): Promise<MediaInfo> {
    if (window.esporteFai) return window.esporteFai.getMediaInfo(url);
    return request(`/api/media-info?url=${encodeURIComponent(url)}`);
  },
  searchMusic(query: string): Promise<YoutubeSearchResult[]> {
    if (window.esporteFai) return window.esporteFai.searchMusic(query);
    return request(`/api/musicas/buscar?q=${encodeURIComponent(query)}`);
  },
  listDownloads(): Promise<DownloadRecord[]> {
    if (window.esporteFai) return window.esporteFai.listDownloads();
    return request("/api/downloads");
  },
  listDownloadHistory(): Promise<DownloadRecord[]> {
    if (window.esporteFai) return window.esporteFai.listDownloadHistory();
    return request("/api/downloads/history");
  },
  downloadFile(record: DownloadRecord): Promise<boolean> {
    if (window.esporteFai) return window.esporteFai.downloadFile(record);
    const link = document.createElement("a");
    link.href = `/api/files/${record.idDownload}`;
    link.download = record.fileName || "";
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    return Promise.resolve(true);
  },
  findCompleted(url: string, type?: DownloadType): Promise<DownloadRecord | null> {
    if (window.esporteFai) return window.esporteFai.findCompleted(url, type);
    const params = new URLSearchParams({ url });
    if (type) params.set("type", type);
    return request(`/api/downloads/completed?${params.toString()}`);
  },
  startDownload(url: string, type: DownloadType): Promise<{ idDownload: number; filePath?: string }> {
    if (window.esporteFai) return window.esporteFai.startDownload(url, type);
    return request("/api/downloads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, type })
    });
  },
  getDownloadProgress(idDownload: number): Promise<ProgressPayload | DownloadRecord | null> {
    if (window.esporteFai) return Promise.resolve(null);
    return request(`/api/downloads/${idDownload}/progress`);
  },
  playExternal(record: DownloadRecord | string): Promise<boolean> {
    if (window.esporteFai) {
      const filePath = typeof record === "string" ? record : record.filePath || "";
      return window.esporteFai.playFile(filePath);
    }
    if (typeof record !== "string") {
      window.open(`/api/files/${record.idDownload}`, "_blank");
      return Promise.resolve(true);
    }
    return Promise.reject(new Error("Arquivo indisponivel no navegador."));
  },
  onProgress(callback: (payload: ProgressPayload) => void) {
    if (window.esporteFai) return window.esporteFai.onProgress(callback);
    return () => undefined;
  }
};

function isLibrarySaveResult(value: unknown): value is UserLibrarySaveResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UserLibrarySaveResult>;
  return (
    typeof candidate.ok === "boolean" &&
    Boolean(candidate.library) &&
    Number.isSafeInteger(candidate.library?.revision) &&
    (candidate.library?.playlists === null || Array.isArray(candidate.library?.playlists))
  );
}
