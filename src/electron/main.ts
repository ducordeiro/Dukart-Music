import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeUsername, verifyPassword } from "./auth";
import { CentralBackendClient, CentralBackendError } from "./centralBackend";
import { CentralSessionStore } from "./centralSessionStore";
import { AppDatabase } from "./database";
import { downloadErrorMessage, downloadMedia } from "./downloader";
import { loadLocalEnv } from "./env";
import { normalizeYoutubeSearchQuery } from "./youtubeSearch";
import type { AuthUser, DownloadType, UserPlaylist } from "../shared/types";
import { parseUserPlaylists } from "../shared/userLibrary";
import { isSupportedYoutubeUrl, youtubeVideoId } from "../shared/youtube";

loadLocalEnv();

let mainWindow: BrowserWindow | null = null;
let database: AppDatabase;
let centralBackend: CentralBackendClient;
let centralSessionStore: CentralSessionStore;
let activeUser: AuthUser | null = null;
let legacyLibraryForActiveUser: UserPlaylist[] | null = null;
const activeDesktopDownloads = new Set<string>();
const activeDesktopDownloadControllers = new Map<number, AbortController>();
const FULL_HISTORY_USERNAME = normalizeUsername(process.env.ESPORTE_FAI_HISTORY_ADMIN_USERNAME || "tocagando1234");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "esporte-fai-media",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
]);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 390,
    minHeight: 620,
    backgroundColor: "#101010",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const webContents = mainWindow.webContents;

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  const productionRendererRoot = pathToFileURL(path.join(__dirname, "../../dist-web") + path.sep).href;
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  webContents.on("will-navigate", (event, targetUrl) => {
    const allowed = devUrl
      ? safelyReadOrigin(targetUrl) === safelyReadOrigin(devUrl)
      : targetUrl.startsWith(productionRendererRoot);
    if (!allowed) event.preventDefault();
  });
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist-web/index.html"));
  }
}

app.whenReady().then(async () => {
  const dbPath = path.join(app.getPath("userData"), "esporte_fai.sqlite");
  const schemaPath = path.join(process.cwd(), "music_app_schema (1).sql");
  database = new AppDatabase(dbPath, schemaPath);
  await database.init();
  centralSessionStore = new CentralSessionStore(path.join(app.getPath("userData"), "central-session.bin"));
  centralBackend = new CentralBackendClient(
    process.env.ESPORTE_FAI_API_URL || "https://e.duk4rt.com",
    centralSessionStore.load()
  );
  protocol.handle("esporte-fai-media", handleLocalMediaRequest);
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle("auth:session", async () => {
  const result = await centralBackend.authSession();
  if (result.user) activateCentralUser(result.user);
  else clearCentralSession();
  return result;
});

ipcMain.handle(
  "auth:register",
  async (
    _event,
    payload: {
      username?: string;
      password?: string;
      passwordConfirmation?: string;
      acceptedPasswordResponsibility?: boolean;
    }
  ) => {
    const username = typeof payload?.username === "string" ? payload.username.trim() : "";
    const password = typeof payload?.password === "string" ? payload.password : "";
    const result = await centralBackend.register({
      username,
      password,
      passwordConfirmation: typeof payload?.passwordConfirmation === "string" ? payload.passwordConfirmation : "",
      acceptedPasswordResponsibility: payload?.acceptedPasswordResponsibility === true
    });
    activateCentralUser(result.user);
    return result;
  }
);

ipcMain.handle("auth:login", async (_event, payload: { username?: string; password?: string }) => {
  const username = typeof payload?.username === "string" ? payload.username.trim() : "";
  const password = typeof payload?.password === "string" ? payload.password : "";
  try {
    const result = await centralBackend.login({ username, password });
    activateCentralUser(result.user);
    return result;
  } catch (error) {
    if (!(error instanceof CentralBackendError) || error.status !== 401) throw error;

    const localUser = database.findUserByNormalizedUsername(normalizeUsername(username));
    const validLocalPassword = localUser
      ? await verifyPassword(password, localUser.passwordHash, localUser.passwordSalt)
      : false;
    if (!localUser || !validLocalPassword) throw error;

    try {
      const migrated = await centralBackend.register({
        username: localUser.username,
        password,
        passwordConfirmation: password,
        acceptedPasswordResponsibility: true
      });
      activateCentralUser(migrated.user);
      return migrated;
    } catch (migrationError) {
      if (migrationError instanceof CentralBackendError && migrationError.status === 409) {
        throw new Error("Essa conta já existe no servidor central, mas a senha não corresponde.");
      }
      throw migrationError;
    }
  }
});

ipcMain.handle("auth:logout", async () => {
  try {
    await centralBackend.logout();
    return true;
  } finally {
    clearCentralSession();
  }
});

ipcMain.handle("library:load", async () => {
  requireDesktopAuth();
  const remoteLibrary = await centralRequest(() => centralBackend.loadLibrary());
  if (remoteLibrary.playlists || !legacyLibraryForActiveUser) return remoteLibrary;

  const playlists = legacyLibraryForActiveUser;
  const saved = await centralRequest(() => centralBackend.saveLibrary(playlists, remoteLibrary.revision));
  legacyLibraryForActiveUser = null;
  return saved.library;
});

ipcMain.handle("library:save", async (_event, playlists: unknown, revision?: number) => {
  requireDesktopAuth();
  return centralRequest(() => centralBackend.saveLibrary(parseUserPlaylists(playlists), revision));
});

ipcMain.handle("media:info", async (_event, url: string) => {
  requireDesktopAuth();
  requireYoutubeUrl(url);
  return centralRequest(() => centralBackend.getMediaInfo(url));
});

ipcMain.handle("downloads:list", async () => {
  const user = requireDesktopAuth();
  return database.listDownloads(user.idUser);
});

ipcMain.handle("downloads:history", async () => {
  const user = requireDesktopAuth();
  if (normalizeUsername(user.username) !== FULL_HISTORY_USERNAME) {
    return database.listDownloadHistory(user.idUser);
  }

  const remoteHistory = await centralRequest(() => centralBackend.listDownloadHistory());
  return remoteHistory.map((record) => {
    const localRecord = database.findCompleted(record.url, record.type, user.idUser);
    return localRecord?.filePath ? localRecord : { ...record, filePath: null };
  });
});

ipcMain.handle("music:search", async (_event, query: string) => {
  requireDesktopAuth();
  const normalized = normalizeYoutubeSearchQuery(query || "");
  if (!normalized) {
    throw new Error("Digite o nome da musica.");
  }
  return centralRequest(() => centralBackend.searchMusic(normalized));
});

ipcMain.handle("downloads:completed", async (_event, url: string, type?: DownloadType) => {
  const user = requireDesktopAuth();
  requireYoutubeUrl(url);
  return database.findCompleted(url, type, user.idUser);
});

ipcMain.handle("downloads:start", async (_event, url: string, type: DownloadType) => {
  const user = requireDesktopAuth();
  requireYoutubeUrl(url);
  const reusableDownload = database.findAnyCompleted(url, type);
  if (reusableDownload?.filePath) {
    database.linkDownloadToUser(user.idUser, reusableDownload.idDownload);
    return { idDownload: reusableDownload.idDownload, filePath: reusableDownload.filePath };
  }
  const downloadKey = `${youtubeVideoId(url)}:${type}`;
  if (activeDesktopDownloads.has(downloadKey)) {
    throw new Error("Este download já está em andamento.");
  }
  if (activeDesktopDownloads.size >= 2) {
    throw new Error("Aguarde um dos downloads em andamento terminar.");
  }
  if (!mainWindow) {
    throw new Error("Main window is not ready.");
  }
  const downloadsDir = path.join(app.getPath("music"), "Esporte fai");
  const controller = new AbortController();
  let trackedDownloadId = 0;
  activeDesktopDownloads.add(downloadKey);
  try {
    return await downloadMedia(
      database,
      url,
      type,
      downloadsDir,
      (payload) => {
        mainWindow?.webContents.send("download-progress", payload);
      },
      (idDownload) => {
        trackedDownloadId = idDownload;
        activeDesktopDownloadControllers.set(idDownload, controller);
        database.linkDownloadToUser(user.idUser, idDownload);
      },
      controller.signal
    );
  } catch (error) {
    console.error("Download failed:", error);
    throw new Error(downloadErrorMessage(error));
  } finally {
    activeDesktopDownloads.delete(downloadKey);
    if (trackedDownloadId) activeDesktopDownloadControllers.delete(trackedDownloadId);
  }
});

ipcMain.handle("downloads:cancel", async (_event, idDownload: number) => {
  const user = requireDesktopAuth();
  const record = database.getDownload(Number(idDownload), user.idUser);
  if (!record) throw new Error("Download não encontrado.");
  const controller = activeDesktopDownloadControllers.get(record.idDownload);
  if (!controller) throw new Error("Este download não está mais em andamento.");
  controller.abort();
  database.cancelDownload(record.idDownload);
  return true;
});

ipcMain.handle("files:play", async (_event, filePath: string) => {
  const user = requireDesktopAuth();
  if (!filePath) {
    throw new Error("No file path was provided.");
  }
  const download = database.getDownloadByFilePath(filePath, user.idUser);
  if (!download?.filePath) {
    throw new Error("Este arquivo nao pertence a biblioteca local desta conta.");
  }
  const result = await shell.openPath(download.filePath);
  if (result) {
    throw new Error(result);
  }
  return true;
});

ipcMain.handle("files:save-copy", async (_event, record: { idDownload?: number }) => {
  const user = requireDesktopAuth();
  const idDownload = Number(record?.idDownload);
  if (!Number.isSafeInteger(idDownload) || idDownload <= 0) {
    throw new Error("Arquivo invalido.");
  }
  const source = database.getDownload(
    idDownload,
    normalizeUsername(user.username) === FULL_HISTORY_USERNAME ? undefined : user.idUser
  );
  if (!source?.filePath || !fs.existsSync(source.filePath)) {
    throw new Error("Este arquivo nao esta disponivel neste computador.");
  }

  const extension = source.type === "video" ? "mp4" : "mp3";
  const saveOptions = {
    title: "Salvar arquivo no dispositivo",
    defaultPath: path.join(app.getPath("downloads"), source.fileName || path.basename(source.filePath)),
    filters: [{ name: source.type === "video" ? "Video MP4" : "Audio MP3", extensions: [extension] }]
  };
  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, saveOptions)
    : await dialog.showSaveDialog(saveOptions);
  if (result.canceled || !result.filePath) return false;
  if (path.resolve(result.filePath) !== path.resolve(source.filePath)) {
    fs.copyFileSync(source.filePath, result.filePath);
  }
  return true;
});

function requireDesktopAuth() {
  if (!activeUser) throw new Error("Faça login para continuar.");
  return activeUser;
}

function activateCentralUser(user: AuthUser) {
  activeUser = user;
  centralSessionStore.save(centralBackend.getSessionToken());
  database.claimUnownedDownloads(user.idUser);
  const localUser = database.findUserByNormalizedUsername(normalizeUsername(user.username));
  legacyLibraryForActiveUser = localUser ? database.loadUserLibrary(localUser.idUser) : null;
}

function clearCentralSession() {
  activeUser = null;
  legacyLibraryForActiveUser = null;
  centralBackend.clearSession();
  centralSessionStore.clear();
}

async function centralRequest<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CentralBackendError && error.status === 401) {
      clearCentralSession();
      mainWindow?.webContents.send("auth-session-expired");
    }
    throw error;
  }
}

function requireYoutubeUrl(url: string) {
  if (!isSupportedYoutubeUrl(url)) {
    throw new Error("Use um link válido do YouTube.");
  }
}

function safelyReadOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function handleLocalMediaRequest(request: Request) {
  const user = activeUser;
  if (!user) return new Response("Faça login para continuar.", { status: 401 });

  let idDownload: number;
  try {
    const parsed = new URL(request.url);
    if (parsed.hostname !== "download") return new Response("Arquivo inválido.", { status: 400 });
    idDownload = Number(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    return new Response("Arquivo inválido.", { status: 400 });
  }

  if (!Number.isSafeInteger(idDownload) || idDownload <= 0) {
    return new Response("Arquivo inválido.", { status: 400 });
  }
  const record = database.getDownload(idDownload, user.idUser);
  if (!record?.filePath || !fs.existsSync(record.filePath)) {
    return new Response("Arquivo não encontrado.", { status: 404 });
  }
  return net.fetch(pathToFileURL(record.filePath).toString(), { headers: request.headers });
}
