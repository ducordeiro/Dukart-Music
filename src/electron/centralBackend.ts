import type {
  AuthResult,
  AuthUser,
  DownloadRecord,
  MediaInfo,
  UserLibrarySaveResult,
  UserLibrarySnapshot,
  UserPlaylist,
  YoutubeSearchResult
} from "../shared/types";

interface CentralAuthResult extends AuthResult {
  sessionToken: string;
}

export class CentralBackendError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly responseBody?: unknown
  ) {
    super(message);
    this.name = "CentralBackendError";
  }
}

export class CentralBackendClient {
  private sessionToken: string | null;

  constructor(
    readonly baseUrl: string,
    sessionToken: string | null = null
  ) {
    this.baseUrl = normalizeCentralBackendUrl(baseUrl);
    this.sessionToken = validSessionToken(sessionToken) ? sessionToken : null;
  }

  getSessionToken() {
    return this.sessionToken;
  }

  clearSession() {
    this.sessionToken = null;
  }

  async authSession(): Promise<{ user: AuthUser | null }> {
    if (!this.sessionToken) return { user: null };
    try {
      return await this.request("/api/auth/session");
    } catch (error) {
      if (error instanceof CentralBackendError && error.status === 401) {
        return { user: null };
      }
      throw error;
    }
  }

  async register(payload: {
    username: string;
    password: string;
    passwordConfirmation: string;
    acceptedPasswordResponsibility: boolean;
  }) {
    const result = await this.request<CentralAuthResult>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    this.acceptAuthResult(result);
    return { user: result.user };
  }

  async login(payload: { username: string; password: string }) {
    const result = await this.request<CentralAuthResult>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    this.acceptAuthResult(result);
    return { user: result.user };
  }

  async logout() {
    if (!this.sessionToken) return;
    try {
      await this.request<void>("/api/auth/logout", { method: "POST" });
    } finally {
      this.clearSession();
    }
  }

  loadLibrary(): Promise<UserLibrarySnapshot> {
    return this.request("/api/library");
  }

  listDownloadHistory(): Promise<DownloadRecord[]> {
    return this.request("/api/downloads/history");
  }

  getMediaInfo(url: string): Promise<MediaInfo> {
    return this.request(`/api/media-info?url=${encodeURIComponent(url)}`);
  }

  searchMusic(query: string): Promise<YoutubeSearchResult[]> {
    return this.request(`/api/musicas/buscar?q=${encodeURIComponent(query)}`);
  }

  async saveLibrary(playlists: UserPlaylist[], revision?: number): Promise<UserLibrarySaveResult> {
    try {
      return await this.request<UserLibrarySaveResult>("/api/library", {
        method: "PUT",
        body: JSON.stringify({ playlists, ...(revision === undefined ? {} : { revision }) })
      });
    } catch (error) {
      if (error instanceof CentralBackendError && error.status === 409 && isLibraryConflict(error.responseBody)) {
        return error.responseBody;
      }
      throw error;
    }
  }

  private acceptAuthResult(result: CentralAuthResult) {
    if (!result?.user || !validSessionToken(result.sessionToken)) {
      throw new CentralBackendError("O servidor central retornou uma sessao invalida.");
    }
    this.sessionToken = result.sessionToken;
  }

  private async request<T>(pathName: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("X-Esporte-Fai-Client", "desktop");
    if (init.body) headers.set("Content-Type", "application/json");
    if (this.sessionToken) headers.set("Authorization", `Bearer ${this.sessionToken}`);

    let response: Response;
    try {
      response = await fetch(new URL(pathName.replace(/^\//, ""), `${this.baseUrl}/`), {
        ...init,
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(20_000)
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError" ? "O servidor demorou para responder." : "Verifique sua conexao.";
      throw new CentralBackendError(`Nao foi possivel conectar ao servidor central. ${reason}`);
    }

    const contentType = response.headers.get("content-type") || "";
    const body =
      response.status === 204
        ? undefined
        : contentType.includes("application/json")
          ? await response.json()
          : await response.text();

    if (!response.ok) {
      if (response.status === 401) this.clearSession();
      const message = typeof body === "object" && body && "error" in body ? String(body.error) : String(body || "");
      throw new CentralBackendError(message || `Falha no servidor central (${response.status}).`, response.status, body);
    }
    return body as T;
  }
}

function isLibraryConflict(value: unknown): value is Extract<UserLibrarySaveResult, { ok: false }> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Extract<UserLibrarySaveResult, { ok: false }>>;
  return (
    candidate.ok === false &&
    candidate.conflict === true &&
    Boolean(candidate.library) &&
    Number.isSafeInteger(candidate.library?.revision) &&
    (candidate.library?.playlists === null || Array.isArray(candidate.library?.playlists))
  );
}

export function normalizeCentralBackendUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("ESPORTE_FAI_API_URL nao possui uma URL valida.");
  }

  const localHost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localHost)) {
    throw new Error("O backend central deve usar HTTPS. HTTP e permitido somente para desenvolvimento local.");
  }
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/+$/, "");
}

function validSessionToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,256}$/.test(value);
}
