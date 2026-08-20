import express from "express";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashPassword, normalizeUsername, validatePassword, validateUsername, verifyPassword } from "../electron/auth";
import { AppDatabase, UserLibraryConflictError } from "../electron/database";
import { downloadErrorMessage, downloadMedia, readMediaInfo, youtubeDownloadSupportStatus } from "../electron/downloader";
import { loadLocalEnv } from "../electron/env";
import { normalizeYoutubeSearchQuery, searchYoutubeMusic } from "../electron/youtubeSearch";
import type { AuthUser, DownloadRecord, DownloadType, ProgressPayload, UserPlaylist } from "../shared/types";
import { parseUserPlaylists } from "../shared/userLibrary";
import { isSupportedYoutubeUrl, youtubeVideoId } from "../shared/youtube";

loadLocalEnv();

const PORT = Number(process.env.PORT || 3001);
const app = express();
const projectRoot = process.cwd();
const rendererDir = path.join(projectRoot, "dist-web");
const downloadsDir = process.env.ESPORTE_FAI_MEDIA_DIR || path.join(os.homedir(), "Music", "Esporte fai");
const dbPath = process.env.ESPORTE_FAI_DB_PATH || path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "esporte-fai", "esporte_fai.sqlite");
const schemaPath = path.join(projectRoot, "music_app_schema (1).sql");
const progressByDownload = new Map<number, ProgressPayload>();
const activeDownloads = new Set<string>();
const authAttempts = new Map<string, { count: number; resetAt: number }>();
const SESSION_COOKIE = "esporte_fai_session";
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const CANONICAL_WEB_HOST = process.env.ESPORTE_FAI_CANONICAL_HOST || "e.duk4rt.com";
const LEGACY_WEB_HOST = process.env.ESPORTE_FAI_LEGACY_HOST || "duk4rt.com";
const FULL_HISTORY_USERNAME = normalizeUsername(process.env.ESPORTE_FAI_HISTORY_ADMIN_USERNAME || "tocagando1234");

const database = new AppDatabase(dbPath, schemaPath);

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: https:; manifest-src 'self'; media-src 'self' blob:; object-src 'none'; script-src 'self'; style-src 'self'; worker-src 'self'"
  );
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (isSecureRequest(req)) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});
app.use((req, res, next) => {
  const hostname = requestHostname(req);
  const isWebNavigation = req.method === "GET" || req.method === "HEAD";
  if (hostname === LEGACY_WEB_HOST && isWebNavigation && !req.path.startsWith("/api/")) {
    res.redirect(308, `https://${CANONICAL_WEB_HOST}${req.originalUrl}`);
    return;
  }
  next();
});
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    port: PORT,
    youtubeApiConfigured: Boolean(process.env.YOUTUBE_API_KEY),
    youtubeDownloadSupport: youtubeDownloadSupportStatus(),
    desktopSync: true,
    librarySchemaVersion: 3
  });
});

app.get("/api/auth/session", (req, res) => {
  const user = readAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Sessão não autenticada." });
    return;
  }
  res.json({ user });
});

app.post("/api/auth/register", enforceSameOrigin, limitAuthAttempts, async (req, res, next) => {
  try {
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const passwordConfirmation = typeof req.body?.passwordConfirmation === "string" ? req.body.passwordConfirmation : "";
    const acceptedPasswordResponsibility = req.body?.acceptedPasswordResponsibility === true;
    const usernameError = validateUsername(username);
    const passwordError = validatePassword(password);

    if (usernameError || passwordError) {
      res.status(400).json({ error: usernameError || passwordError });
      return;
    }
    if (password !== passwordConfirmation) {
      res.status(400).json({ error: "A confirmação da senha não corresponde." });
      return;
    }
    if (!acceptedPasswordResponsibility) {
      res.status(400).json({ error: "Confirme sua responsabilidade sobre a senha." });
      return;
    }

    const usernameNormalized = normalizeUsername(username);
    if (database.findUserByNormalizedUsername(usernameNormalized)) {
      res.status(409).json({ error: "Este nome de usuário não está disponível." });
      return;
    }

    const { passwordHash, passwordSalt } = await hashPassword(password);
    const user = database.createUser(username, usernameNormalized, passwordHash, passwordSalt);
    database.claimUnownedDownloads(user.idUser);
    const sessionToken = setAuthenticatedSession(req, res, user);
    clearAuthAttempts(req);
    res.status(201).json(authenticatedPayload(req, user, sessionToken));
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
      res.status(409).json({ error: "Este nome de usuário não está disponível." });
      return;
    }
    next(error);
  }
});

app.post("/api/auth/login", enforceSameOrigin, limitAuthAttempts, async (req, res, next) => {
  try {
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!username || !password) {
      res.status(400).json({ error: "Informe o nome de usuário e a senha." });
      return;
    }

    const storedUser = database.findUserByNormalizedUsername(normalizeUsername(username));
    const validPassword = storedUser
      ? await verifyPassword(password, storedUser.passwordHash, storedUser.passwordSalt)
      : await verifyPassword(password, FAKE_PASSWORD_HASH, FAKE_PASSWORD_SALT);

    if (!storedUser || !validPassword) {
      res.status(401).json({ error: "Usuário ou senha inválidos." });
      return;
    }

    const user = { idUser: storedUser.idUser, username: storedUser.username };
    const sessionToken = setAuthenticatedSession(req, res, user);
    clearAuthAttempts(req);
    res.json(authenticatedPayload(req, user, sessionToken));
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", enforceSameOrigin, (req, res) => {
  const token = readSessionToken(req);
  if (token) database.deleteSession(hashSessionToken(token));
  clearSessionCookie(req, res);
  res.status(204).end();
});

app.use("/api", (req, res, next) => {
  const user = readAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Faça login para continuar." });
    return;
  }
  res.locals.authUser = user;
  next();
});

app.get("/api/library", (_req, res) => {
  const user = res.locals.authUser as AuthUser;
  res.json(database.loadUserLibraryState(user.idUser));
});

app.put("/api/library", enforceSameOrigin, (req, res, next) => {
  let playlists: UserPlaylist[];
  let expectedRevision: number | undefined;
  try {
    playlists = parseUserPlaylists(req.body?.playlists);
    if (req.body?.revision !== undefined) {
      if (!Number.isSafeInteger(req.body.revision) || req.body.revision < 0) {
        throw new Error("Revisao da biblioteca invalida.");
      }
      expectedRevision = req.body.revision;
    }
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Biblioteca de playlists invalida."
    });
    return;
  }

  try {
    const user = res.locals.authUser as AuthUser;
    const library = database.saveUserLibrary(user.idUser, playlists, expectedRevision);
    res.json({ ok: true, library });
  } catch (error) {
    if (error instanceof UserLibraryConflictError) {
      res.status(409).json({
        ok: false,
        conflict: true,
        error: error.message,
        library: error.latest
      });
      return;
    }
    next(error);
  }
});

app.get("/api/media-info", async (req, res, next) => {
  try {
    const url = String(req.query.url || "");
    if (!isSupportedYoutubeUrl(url)) {
      res.status(400).json({ error: "Use um link válido do YouTube." });
      return;
    }
    res.json(await readMediaInfo(url));
  } catch (error) {
    next(error);
  }
});

app.get("/api/downloads", (_req, res) => {
  const user = res.locals.authUser as AuthUser;
  res.json(database.listDownloads(user.idUser).map(withFileAvailability));
});

app.get("/api/downloads/history", (_req, res) => {
  const user = res.locals.authUser as AuthUser;
  const idUser = canViewFullHistory(user) ? undefined : user.idUser;
  res.json(database.listDownloadHistory(idUser).map(withFileAvailability));
});

app.get("/api/musicas/buscar", async (req, res, next) => {
  try {
    const query = normalizeYoutubeSearchQuery(String(req.query.q || ""));
    if (!query) {
      res.status(400).json({ error: "Digite o nome da musica." });
      return;
    }

    res.json(await searchYoutubeMusic(database, query));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    if (detail.includes("YOUTUBE_API_KEY")) {
      res.status(503).json({ error: "A busca de músicas ainda não foi configurada no servidor." });
      return;
    }
    if (/youtube data api|quota|api key/i.test(detail)) {
      res.status(502).json({ error: "A busca do YouTube está temporariamente indisponível." });
      return;
    }
    next(error);
  }
});

app.get("/api/downloads/completed", (req, res) => {
  const url = String(req.query.url || "");
  const type = req.query.type ? String(req.query.type) : undefined;
  if (!isSupportedYoutubeUrl(url) || (type && !isDownloadType(type))) {
    res.status(400).json({ error: "Invalid request." });
    return;
  }
  const user = res.locals.authUser as AuthUser;
  const record = database.findCompleted(url, type as DownloadType | undefined, user.idUser);
  res.json(record && isFileAvailable(record) ? withFileAvailability(record) : null);
});

app.get("/api/downloads/:id/progress", (req, res) => {
  const id = Number(req.params.id);
  const user = res.locals.authUser as AuthUser;
  const record = database.getDownload(id, user.idUser);
  if (!record) {
    res.status(404).json({ error: "Download nao encontrado." });
    return;
  }
  const progress = progressByDownload.get(id);
  res.json(progress || (record ? withFileAvailability(record) : null));
});

app.post("/api/downloads", async (req, res, next) => {
  let downloadKey = "";
  let trackedDownloadId = 0;
  let responseStarted = false;
  try {
    const { url, type } = req.body as { url?: string; type?: DownloadType };
    if (!url || !isSupportedYoutubeUrl(url) || !isDownloadType(type)) {
      res.status(400).json({ error: "Use um link válido do YouTube e escolha áudio ou vídeo." });
      return;
    }
    const user = res.locals.authUser as AuthUser;
    const reusableDownload = database.findAnyCompleted(url, type);
    if (reusableDownload && isFileAvailable(reusableDownload)) {
      database.linkDownloadToUser(user.idUser, reusableDownload.idDownload);
      res.json(withFileAvailability(reusableDownload));
      return;
    }
    downloadKey = `${youtubeVideoId(url)}:${type}`;
    if (activeDownloads.has(downloadKey)) {
      res.status(409).json({ error: "Este download já está em andamento." });
      return;
    }
    if (activeDownloads.size >= 2) {
      res.status(429).json({ error: "O servidor já está processando dois downloads. Aguarde um deles terminar." });
      return;
    }
    activeDownloads.add(downloadKey);

    const result = await downloadMedia(
      database,
      url,
      type,
      downloadsDir,
      (payload) => {
        progressByDownload.set(payload.idDownload, payload);
      },
      (idDownload) => {
        trackedDownloadId = idDownload;
        database.linkDownloadToUser(user.idUser, idDownload);
        responseStarted = true;
        res.status(202).json({ idDownload });
      }
    );

    if (!responseStarted) res.json(result);
  } catch (error) {
    console.error("Download failed:", error);
    if (!res.headersSent) {
      res.status(502).json({ error: downloadErrorMessage(error) });
    }
  } finally {
    if (downloadKey) activeDownloads.delete(downloadKey);
    if (trackedDownloadId) progressByDownload.delete(trackedDownloadId);
  }
});

app.get("/api/files/:id", (req, res) => {
  const user = res.locals.authUser as AuthUser;
  const record = database.getDownload(Number(req.params.id), canViewFullHistory(user) ? undefined : user.idUser);
  if (!record?.filePath || !fs.existsSync(record.filePath)) {
    res.status(404).json({ error: "File not found." });
    return;
  }

  res.download(record.filePath, record.fileName || path.basename(record.filePath));
});

app.get("/api/files/:id/stream", (req, res) => {
  const user = res.locals.authUser as AuthUser;
  const record = database.getDownload(Number(req.params.id), canViewFullHistory(user) ? undefined : user.idUser);
  if (!record?.filePath || !fs.existsSync(record.filePath)) {
    res.status(404).json({ error: "File not found." });
    return;
  }

  const extension = path.extname(record.filePath).toLowerCase();
  const contentType = extension === ".mp4" ? "video/mp4" : "audio/mpeg";
  const stat = fs.statSync(record.filePath);
  const range = req.headers.range;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", contentDispositionInline(record.fileName || path.basename(record.filePath)));
  res.setHeader("Accept-Ranges", "bytes");

  if (range) {
    const parsedRange = parseByteRange(range, stat.size);
    if (!parsedRange) {
      res.status(416).setHeader("Content-Range", `bytes */${stat.size}`);
      res.end();
      return;
    }
    const { start, end } = parsedRange;

    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    res.setHeader("Content-Length", end - start + 1);
    fs.createReadStream(record.filePath, { start, end }).pipe(res);
    return;
  }

  res.setHeader("Content-Length", stat.size);
  fs.createReadStream(record.filePath).pipe(res);
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Endpoint não encontrado." });
});

app.get("/sw.js", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.sendFile(path.join(rendererDir, "sw.js"));
});
app.use(express.static(rendererDir));
app.use((req, res) => {
  if (path.extname(req.path)) {
    res.status(404).type("text/plain").send("Arquivo não encontrado.");
    return;
  }
  res.sendFile(path.join(rendererDir, "index.html"));
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (isMalformedJsonError(error)) {
    res.status(400).json({ error: "Os dados enviados não são válidos." });
    return;
  }
  console.error("Unexpected server error:", error);
  res.status(500).json({ error: "Erro interno do servidor." });
});

database.init().then(() => {
  database.linkUnownedDownloadsToExistingUsers();
  database.deleteExpiredSessions(new Date().toISOString());
  fs.mkdirSync(downloadsDir, { recursive: true });
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Dukart Music web server running on http://localhost:${PORT}`);
    console.log(`Downloads: ${downloadsDir}`);
    console.log(`Database: ${dbPath}`);
  });
});

function isDownloadType(value: unknown): value is DownloadType {
  return value === "audio" || value === "video";
}

function canViewFullHistory(user: AuthUser) {
  return normalizeUsername(user.username) === FULL_HISTORY_USERNAME;
}

function isFileAvailable(record: DownloadRecord) {
  return Boolean(record.filePath && fs.existsSync(record.filePath));
}

function withFileAvailability(record: DownloadRecord): DownloadRecord {
  if (record.filePath && fs.existsSync(record.filePath)) {
    return {
      ...record,
      filePath: record.fileName || path.basename(record.filePath)
    };
  }
  if (!record.filePath) return record;
  return {
    ...record,
    status: "failed",
    filePath: null,
    fileName: null,
    sizeBytes: null,
    errorMessage: "Arquivo de mídia não encontrado no servidor."
  };
}

function parseByteRange(header: string, size: number) {
  if (!Number.isSafeInteger(size) || size <= 0 || !header.startsWith("bytes=") || header.includes(",")) return null;
  const parts = header.slice(6).split("-");
  if (parts.length !== 2) return null;
  const [startPart, endPart] = parts;

  if (!startPart) {
    if (!/^\d+$/.test(endPart)) return null;
    const suffixLength = Number.parseInt(endPart, 10);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  if (!/^\d+$/.test(startPart) || (endPart && !/^\d+$/.test(endPart))) return null;
  const start = Number.parseInt(startPart, 10);
  const requestedEnd = endPart ? Number.parseInt(endPart, 10) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function contentDispositionInline(fileName: string) {
  const fallback = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987Value(fileName)}`;
}

function encodeRfc5987Value(value: string) {
  return encodeURIComponent(value)
    .replace(/['()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");
}

const FAKE_PASSWORD_SALT = Buffer.alloc(16, 1).toString("base64");
const FAKE_PASSWORD_HASH = Buffer.alloc(64, 1).toString("base64");

function setAuthenticatedSession(req: express.Request, res: express.Response, user: AuthUser) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  database.createSession(user.idUser, hashSessionToken(token), expiresAt.toISOString());
  if (!isDesktopClient(req)) {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureRequest(req),
      maxAge: SESSION_DURATION_MS,
      path: "/"
    });
  }
  return token;
}

function readAuthenticatedUser(req: express.Request) {
  const token = readSessionToken(req);
  if (!token) return null;
  return database.findSessionUser(hashSessionToken(token), new Date().toISOString());
}

function authenticatedPayload(req: express.Request, user: AuthUser, sessionToken: string) {
  return isDesktopClient(req) ? { user, sessionToken } : { user };
}

function isDesktopClient(req: express.Request) {
  return req.get("x-esporte-fai-client") === "desktop";
}

function readSessionToken(req: express.Request) {
  const authorization = req.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+([A-Za-z0-9_-]{32,256})$/i);
  return bearer?.[1] || readCookie(req, SESSION_COOKIE);
}

function clearSessionCookie(req: express.Request, res: express.Response) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    path: "/"
  });
}

function readCookie(req: express.Request, name: string) {
  const cookieHeader = req.headers.cookie || "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function isSecureRequest(req: express.Request) {
  return req.secure || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

function requestHostname(req: express.Request) {
  return String(req.headers["x-forwarded-host"] || req.get("host") || "")
    .split(",")[0]
    .trim()
    .replace(/:\d+$/, "")
    .toLocaleLowerCase("en-US");
}

function enforceSameOrigin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const origin = req.get("origin");
  if (!origin) {
    next();
    return;
  }
  try {
    const originHost = new URL(origin).host;
    const requestHost = String(req.headers["x-forwarded-host"] || req.get("host") || "").split(",")[0].trim();
    if (originHost === requestHost) {
      next();
      return;
    }
  } catch {
    // Invalid origins are rejected below.
  }
  res.status(403).json({ error: "Origem da solicitação não autorizada." });
}

function limitAuthAttempts(req: express.Request, res: express.Response, next: express.NextFunction) {
  const key = authAttemptKey(req);
  const now = Date.now();
  if (authAttempts.size > 1000) {
    for (const [attemptKey, attempt] of authAttempts) {
      if (attempt.resetAt <= now) authAttempts.delete(attemptKey);
    }
  }
  const current = authAttempts.get(key);
  if (!current || current.resetAt <= now) {
    authAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    next();
    return;
  }
  if (current.count >= 20) {
    res.setHeader("Retry-After", Math.ceil((current.resetAt - now) / 1000));
    res.status(429).json({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." });
    return;
  }
  current.count += 1;
  next();
}

function clearAuthAttempts(req: express.Request) {
  authAttempts.delete(authAttemptKey(req));
}

function authAttemptKey(req: express.Request) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (req.path.endsWith("/login")) {
    const username = typeof req.body?.username === "string" ? normalizeUsername(req.body.username) : "<empty>";
    return `login:${ip}:${username}`;
  }
  return `register:${ip}`;
}

function isMalformedJsonError(error: unknown): error is Error & { status: number; type: string } {
  return (
    error instanceof Error &&
    "status" in error &&
    "type" in error &&
    error.status === 400 &&
    error.type === "entity.parse.failed"
  );
}
