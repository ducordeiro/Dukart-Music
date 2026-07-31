import fs from "node:fs";
import path from "node:path";
import initSqlJs, { Database, SqlJsStatic, SqlValue } from "sql.js";
import type {
  AuthUser,
  DownloadRecord,
  DownloadType,
  MediaInfo,
  UserLibrarySnapshot,
  UserPlaylist,
  YoutubeSearchResult
} from "../shared/types";
import { parseUserPlaylists } from "../shared/userLibrary";
import { youtubeVideoId } from "../shared/youtube";

export interface StoredUser extends AuthUser {
  usernameNormalized: string;
  passwordHash: string;
  passwordSalt: string;
}

export class UserLibraryConflictError extends Error {
  constructor(readonly latest: UserLibrarySnapshot) {
    super("A biblioteca foi alterada em outro dispositivo.");
    this.name = "UserLibraryConflictError";
  }
}

export class AppDatabase {
  private SQL: SqlJsStatic | null = null;
  private db: Database | null = null;
  private saveSequence = 0;
  private lastBackupAt = 0;

  constructor(
    private readonly dbPath: string,
    private readonly schemaPath: string
  ) {}

  async init() {
    this.SQL = await initSqlJs({
      locateFile: (file) => require.resolve(`sql.js/dist/${file}`)
    });

    this.recoverInterruptedSave();
    if (fs.existsSync(this.dbPath)) {
      this.db = this.openValidatedDatabase(this.dbPath);
    } else {
      this.db = new this.SQL.Database();
      const schema = fs.readFileSync(this.schemaPath, "utf8");
      this.db.run(schema);
      this.save();
    }

    this.requireDb().run("PRAGMA foreign_keys = ON");
    this.ensureAuthSchema();
    this.ensureUserLibrarySchema();
    this.ensureUserDownloadSchema();
    this.ensureYoutubeSearchCache();
    this.ensureMediaInfoCache();
    this.markInterruptedDownloads();
  }

  findUserByNormalizedUsername(usernameNormalized: string) {
    return this.getOne<StoredUser>(
      `SELECT id_user AS idUser, username, username_normalized AS usernameNormalized,
              password_hash AS passwordHash, password_salt AS passwordSalt
       FROM app_user
       WHERE username_normalized = ?
       LIMIT 1`,
      [usernameNormalized]
    );
  }

  createUser(username: string, usernameNormalized: string, passwordHash: string, passwordSalt: string) {
    const db = this.requireDb();
    db.run(
      `INSERT INTO app_user (username, username_normalized, password_hash, password_salt, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [username, usernameNormalized, passwordHash, passwordSalt, new Date().toISOString()]
    );
    const user = { idUser: this.lastInsertId(), username };
    this.save();
    return user;
  }

  createSession(idUser: number, tokenHash: string, expiresAt: string) {
    const now = new Date().toISOString();
    this.requireDb().run(
      `INSERT INTO auth_session (id_user, token_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?)`,
      [idUser, tokenHash, now, expiresAt]
    );
    this.save();
  }

  findSessionUser(tokenHash: string, now: string) {
    return this.getOne<AuthUser>(
      `SELECT u.id_user AS idUser, u.username
       FROM auth_session s
       JOIN app_user u ON u.id_user = s.id_user
       WHERE s.token_hash = ? AND s.expires_at > ?
       LIMIT 1`,
      [tokenHash, now]
    );
  }

  deleteSession(tokenHash: string) {
    this.requireDb().run("DELETE FROM auth_session WHERE token_hash = ?", [tokenHash]);
    this.save();
  }

  deleteExpiredSessions(now: string) {
    this.requireDb().run("DELETE FROM auth_session WHERE expires_at <= ?", [now]);
    this.save();
  }

  loadUserLibrary(idUser: number) {
    return this.loadUserLibraryState(idUser).playlists;
  }

  loadUserLibraryState(idUser: number): UserLibrarySnapshot {
    const stored = this.getOne<{ playlistsJson: string; revision: number }>(
      `SELECT playlists_json AS playlistsJson, revision
       FROM user_library
       WHERE id_user = ?
       LIMIT 1`,
      [idUser]
    );
    if (!stored) return { playlists: null, revision: 0 };
    return {
      playlists: parseUserPlaylists(JSON.parse(stored.playlistsJson)),
      revision: stored.revision
    };
  }

  saveUserLibrary(idUser: number, playlists: UserPlaylist[], expectedRevision?: number): UserLibrarySnapshot {
    const normalized = parseUserPlaylists(playlists);
    const current = this.loadUserLibraryState(idUser);
    if (expectedRevision !== undefined && current.revision !== expectedRevision) {
      throw new UserLibraryConflictError(current);
    }

    const now = new Date().toISOString();
    const nextRevision = current.revision + 1;
    this.requireDb().run(
      `INSERT INTO user_library (id_user, playlists_json, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id_user) DO UPDATE SET
         playlists_json = excluded.playlists_json,
         revision = excluded.revision,
         updated_at = excluded.updated_at`,
      [idUser, JSON.stringify(normalized), nextRevision, now, now]
    );
    this.save();
    return { playlists: normalized, revision: nextRevision };
  }

  upsertMedia(url: string, info: MediaInfo) {
    const db = this.requireDb();
    const externalId = info.id ?? null;
    const existing = this.getOne<{ id_media: number }>(
      "SELECT id_media FROM media_source WHERE source_url = ? OR (external_id IS NOT NULL AND external_id = ?) LIMIT 1",
      [url, externalId]
    );

    if (existing) {
      db.run(
        `UPDATE media_source
         SET source_url = ?, title = COALESCE(?, title), channel_name = COALESCE(?, channel_name),
             duration_seconds = COALESCE(?, duration_seconds), thumbnail_url = COALESCE(?, thumbnail_url)
         WHERE id_media = ?`,
        [url, info.title ?? null, info.channel ?? null, info.duration ?? null, info.thumbnail ?? null, existing.id_media]
      );
      this.save();
      return existing.id_media;
    }

    db.run(
      `INSERT INTO media_source
       (source_url, platform, external_id, title, channel_name, duration_seconds, thumbnail_url)
       VALUES (?, 'youtube', ?, ?, ?, ?, ?)`,
      [url, externalId, info.title ?? null, info.channel ?? null, info.duration ?? null, info.thumbnail ?? null]
    );
    const idMedia = this.lastInsertId();
    this.save();
    return idMedia;
  }

  createDownload(idMedia: number, type: DownloadType) {
    const db = this.requireDb();
    db.run(
      `INSERT INTO download (id_media, requested_type, status, started_at, progress_percent)
       VALUES (?, ?, 'downloading', CURRENT_TIMESTAMP, 0)`,
      [idMedia, type]
    );
    const idDownload = this.lastInsertId();
    this.save();
    return idDownload;
  }

  linkDownloadToUser(idUser: number, idDownload: number) {
    const db = this.requireDb();
    db.run(
      `INSERT OR IGNORE INTO user_download (id_user, id_download, created_at)
       VALUES (?, ?, ?)`,
      [idUser, idDownload, new Date().toISOString()]
    );
    if (db.getRowsModified() > 0) this.save();
  }

  linkUnownedDownloadsToExistingUsers() {
    const db = this.requireDb();
    db.run(
      `INSERT OR IGNORE INTO user_download (id_user, id_download, created_at)
       SELECT u.id_user, d.id_download, ?
       FROM app_user u
       CROSS JOIN download d
       WHERE NOT EXISTS (
         SELECT 1 FROM user_download ud WHERE ud.id_download = d.id_download
       )`,
      [new Date().toISOString()]
    );
    if (db.getRowsModified() > 0) this.save();
  }

  claimUnownedDownloads(idUser: number) {
    const db = this.requireDb();
    db.run(
      `INSERT OR IGNORE INTO user_download (id_user, id_download, created_at)
       SELECT ?, d.id_download, ?
       FROM download d
       WHERE NOT EXISTS (
         SELECT 1 FROM user_download ud WHERE ud.id_download = d.id_download
       )`,
      [idUser, new Date().toISOString()]
    );
    if (db.getRowsModified() > 0) this.save();
  }

  updateProgress(idDownload: number, progress: number) {
    this.requireDb().run(
      "UPDATE download SET progress_percent = ?, status = 'downloading' WHERE id_download = ?",
      [Math.max(0, Math.min(100, progress)), idDownload]
    );
    this.save();
  }

  completeDownload(idDownload: number, filePath: string, mimeType: string | null, sizeBytes: number | null, checksumSha256?: string | null) {
    const db = this.requireDb();
    const fileName = path.basename(filePath);
    const fileExtension = path.extname(filePath).replace(".", "").toLowerCase() || "file";
    db.run(
      `UPDATE download
       SET status = 'completed', progress_percent = 100, completed_at = CURRENT_TIMESTAMP, error_message = NULL
       WHERE id_download = ?`,
      [idDownload]
    );
    db.run(
      `INSERT OR REPLACE INTO local_file
       (id_download, file_path, file_name, file_extension, mime_type, size_bytes, checksum_sha256)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [idDownload, filePath, fileName, fileExtension, mimeType, sizeBytes, checksumSha256 ?? null]
    );
    this.save();
  }

  failDownload(idDownload: number, message: string) {
    this.requireDb().run(
      `UPDATE download
       SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP
       WHERE id_download = ?`,
      [message, idDownload]
    );
    this.save();
  }

  cancelDownload(idDownload: number) {
    this.requireDb().run(
      `UPDATE download
       SET status = 'cancelled', error_message = NULL, completed_at = CURRENT_TIMESTAMP
       WHERE id_download = ? AND status IN ('pending', 'downloading')`,
      [idDownload]
    );
    this.save();
  }

  findCompleted(url: string, type?: DownloadType, idUser?: number) {
    const externalId = youtubeVideoId(url);
    const whereMedia = externalId
      ? "(m.source_url = ? OR m.external_id = ?)"
      : "m.source_url = ?";
    const whereType = type ? "AND d.requested_type = ?" : "";
    const whereUser =
      idUser === undefined
        ? ""
        : `AND (
             EXISTS (
               SELECT 1 FROM user_download ud
               WHERE ud.id_download = d.id_download AND ud.id_user = ?
             )
             OR NOT EXISTS (
               SELECT 1 FROM user_download any_ud
               WHERE any_ud.id_download = d.id_download
             )
           )`;
    const params: SqlValue[] = [
      url,
      ...(externalId ? [externalId] : []),
      ...(type ? [type] : []),
      ...(idUser === undefined ? [] : [idUser])
    ];
    return this.getOne<DownloadRecord>(
      `SELECT d.id_download AS idDownload, m.source_url AS url, COALESCE(m.title, 'Untitled media') AS title,
              COALESCE(m.channel_name, '') AS channel, d.requested_type AS type, d.status,
              d.progress_percent AS progress, lf.file_path AS filePath, lf.file_name AS fileName,
              lf.size_bytes AS sizeBytes, lf.checksum_sha256 AS checksumSha256, d.created_at AS createdAt, d.completed_at AS completedAt,
              d.error_message AS errorMessage
       FROM download d
       JOIN media_source m ON m.id_media = d.id_media
       JOIN local_file lf ON lf.id_download = d.id_download
       WHERE ${whereMedia} AND d.status = 'completed'
          AND (m.external_id IS NULL OR instr(lf.file_path, m.external_id) > 0)
          ${whereType}
          ${whereUser}
        ORDER BY d.completed_at DESC, d.created_at DESC
       LIMIT 1`,
      params
    );
  }

  findAnyCompleted(url: string, type: DownloadType) {
    return this.findCompleted(url, type);
  }

  listDownloads(idUser?: number, ownership: "legacy-compatible" | "strict" = "legacy-compatible") {
    const whereUser =
      idUser === undefined
        ? ""
        : ownership === "strict"
          ? `WHERE EXISTS (
               SELECT 1 FROM user_download ud
               WHERE ud.id_download = d.id_download AND ud.id_user = ?
             )`
          : `WHERE EXISTS (
             SELECT 1 FROM user_download ud
             WHERE ud.id_download = d.id_download AND ud.id_user = ?
           )
           OR NOT EXISTS (
             SELECT 1 FROM user_download any_ud
             WHERE any_ud.id_download = d.id_download
           )`;
    return this.getAll<DownloadRecord>(
      `SELECT d.id_download AS idDownload, m.source_url AS url, COALESCE(m.title, 'Untitled media') AS title,
              COALESCE(m.channel_name, '') AS channel, d.requested_type AS type, d.status,
              d.progress_percent AS progress, lf.file_path AS filePath, lf.file_name AS fileName,
              lf.size_bytes AS sizeBytes, lf.checksum_sha256 AS checksumSha256, d.created_at AS createdAt, d.completed_at AS completedAt,
              d.error_message AS errorMessage
       FROM download d
       JOIN media_source m ON m.id_media = d.id_media
        LEFT JOIN local_file lf
          ON lf.id_download = d.id_download
         AND (m.external_id IS NULL OR instr(lf.file_path, m.external_id) > 0)
        ${whereUser}
        ORDER BY d.created_at DESC`,
      idUser === undefined ? [] : [idUser]
    );
  }

  listDownloadHistory(idUser?: number) {
    const records = this.listDownloads(idUser, "strict");

    return [...records].sort(
      (left, right) =>
        Date.parse(right.completedAt || right.createdAt) - Date.parse(left.completedAt || left.createdAt)
    );
  }

  getDownload(idDownload: number, idUser?: number) {
    const whereUser =
      idUser === undefined
        ? ""
        : `AND (
             EXISTS (
               SELECT 1 FROM user_download ud
               WHERE ud.id_download = d.id_download AND ud.id_user = ?
             )
             OR NOT EXISTS (
               SELECT 1 FROM user_download any_ud
               WHERE any_ud.id_download = d.id_download
             )
           )`;
    return this.getOne<DownloadRecord>(
      `SELECT d.id_download AS idDownload, m.source_url AS url, COALESCE(m.title, 'Untitled media') AS title,
              COALESCE(m.channel_name, '') AS channel, d.requested_type AS type, d.status,
              d.progress_percent AS progress, lf.file_path AS filePath, lf.file_name AS fileName,
              lf.size_bytes AS sizeBytes, lf.checksum_sha256 AS checksumSha256, d.created_at AS createdAt, d.completed_at AS completedAt,
              d.error_message AS errorMessage
       FROM download d
       JOIN media_source m ON m.id_media = d.id_media
       LEFT JOIN local_file lf
         ON lf.id_download = d.id_download
        AND (m.external_id IS NULL OR instr(lf.file_path, m.external_id) > 0)
        WHERE d.id_download = ?
        ${whereUser}
        LIMIT 1`,
      [idDownload, ...(idUser === undefined ? [] : [idUser])]
    );
  }

  getDownloadByFilePath(filePath: string, idUser: number) {
    const normalizedPath = path.resolve(filePath);
    return this.listDownloads(idUser).find(
      (record) => record.filePath && path.resolve(record.filePath) === normalizedPath
    ) || null;
  }

  getYoutubeSearchCache(query: string, maxAgeMs: number) {
    const cached = this.getOne<{ resultsJson: string; updatedAt: string }>(
      `SELECT results_json AS resultsJson, updated_at AS updatedAt
       FROM youtube_search_cache
       WHERE query = ?
       LIMIT 1`,
      [query]
    );

    if (!cached) return null;

    const updatedAt = new Date(cached.updatedAt).getTime();
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > maxAgeMs) {
      return null;
    }

    try {
      const parsed = JSON.parse(cached.resultsJson) as YoutubeSearchResult[];
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  saveYoutubeSearchCache(query: string, results: YoutubeSearchResult[]) {
    const now = new Date().toISOString();
    this.requireDb().run(
      `INSERT INTO youtube_search_cache (query, results_json, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(query) DO UPDATE SET
         results_json = excluded.results_json,
         updated_at = excluded.updated_at`,
      [query, JSON.stringify(results), now, now]
    );
    this.save();
  }

  getMediaInfoCache(url: string, maxAgeMs: number) {
    const cached = this.getOne<{ infoJson: string; updatedAt: string }>(
      `SELECT info_json AS infoJson, updated_at AS updatedAt
       FROM media_info_cache
       WHERE source_key = ?
       LIMIT 1`,
      [youtubeVideoId(url) || url]
    );
    if (!cached || Date.now() - Date.parse(cached.updatedAt) > maxAgeMs) return null;
    try {
      return JSON.parse(cached.infoJson) as MediaInfo;
    } catch {
      return null;
    }
  }

  saveMediaInfoCache(url: string, info: MediaInfo) {
    const now = new Date().toISOString();
    this.requireDb().run(
      `INSERT INTO media_info_cache (source_key, info_json, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(source_key) DO UPDATE SET info_json = excluded.info_json, updated_at = excluded.updated_at`,
      [youtubeVideoId(url) || url, JSON.stringify(info), now, now]
    );
    this.save();
  }

  private ensureYoutubeSearchCache() {
    const db = this.requireDb();
    db.run(
      `CREATE TABLE IF NOT EXISTS youtube_search_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL UNIQUE,
        results_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    );
    db.run("CREATE INDEX IF NOT EXISTS idx_youtube_search_cache_query ON youtube_search_cache (query)");
    this.save();
  }

  private ensureMediaInfoCache() {
    this.requireDb().run(
      `CREATE TABLE IF NOT EXISTS media_info_cache (
        source_key TEXT PRIMARY KEY,
        info_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    );
    this.save();
  }

  private ensureAuthSchema() {
    const db = this.requireDb();
    db.run(
      `CREATE TABLE IF NOT EXISTS app_user (
        id_user INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        username_normalized TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`
    );
    db.run(
      `CREATE TABLE IF NOT EXISTS auth_session (
        id_session INTEGER PRIMARY KEY AUTOINCREMENT,
        id_user INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (id_user) REFERENCES app_user(id_user) ON DELETE CASCADE
      )`
    );
    db.run("CREATE INDEX IF NOT EXISTS idx_auth_session_token ON auth_session (token_hash)");
    db.run("CREATE INDEX IF NOT EXISTS idx_auth_session_expiry ON auth_session (expires_at)");
    this.save();
  }

  private ensureUserLibrarySchema() {
    const db = this.requireDb();
    db.run(
      `CREATE TABLE IF NOT EXISTS user_library (
        id_user INTEGER PRIMARY KEY,
        playlists_json TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (id_user) REFERENCES app_user(id_user) ON UPDATE CASCADE ON DELETE CASCADE
      )`
    );
    const columns = this.getAll<{ name: string }>("PRAGMA table_info(user_library)");
    if (!columns.some((column) => column.name === "revision")) {
      db.run("ALTER TABLE user_library ADD COLUMN revision INTEGER NOT NULL DEFAULT 1");
    }
    this.save();
  }

  private ensureUserDownloadSchema() {
    const db = this.requireDb();
    db.run(
      `CREATE TABLE IF NOT EXISTS user_download (
        id_user INTEGER NOT NULL,
        id_download INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (id_user, id_download),
        FOREIGN KEY (id_download) REFERENCES download(id_download) ON UPDATE CASCADE ON DELETE CASCADE
      )`
    );
    db.run("CREATE INDEX IF NOT EXISTS idx_user_download_user ON user_download (id_user, created_at)");
    db.run("CREATE INDEX IF NOT EXISTS idx_user_download_download ON user_download (id_download)");
    this.save();
  }

  private markInterruptedDownloads() {
    this.requireDb().run(
      `UPDATE download
       SET status = 'failed',
           error_message = 'Download interrupted before completion.',
           completed_at = CURRENT_TIMESTAMP
       WHERE status IN ('pending', 'downloading')`
    );
    this.save();
  }

  private lastInsertId() {
    return Number(this.requireDb().exec("SELECT last_insert_rowid() AS id")[0].values[0][0]);
  }

  private getOne<T>(sql: string, params: SqlValue[] = []): T | null {
    return this.getAll<T>(sql, params)[0] ?? null;
  }

  private getAll<T>(sql: string, params: SqlValue[] = []): T[] {
    const statement = this.requireDb().prepare(sql);
    statement.bind(params);
    const rows: T[] = [];
    while (statement.step()) {
      rows.push(statement.getAsObject() as T);
    }
    statement.free();
    return rows;
  }

  private save() {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    // A unique path avoids collisions between consecutive exports on Windows,
    // where antivirus and sync filters may keep a just-renamed .tmp handle open.
    this.saveSequence += 1;
    const temporaryPath = `${this.dbPath}.${process.pid}.${this.saveSequence}.tmp`;
    const exported = Buffer.from(this.requireDb().export());
    this.validateDatabaseBytes(exported);
    fs.writeFileSync(temporaryPath, exported, { flag: "wx" });
    const temporaryHandle = fs.openSync(temporaryPath, "r+");
    try {
      fs.fsyncSync(temporaryHandle);
    } finally {
      fs.closeSync(temporaryHandle);
    }
    this.backupDatabaseIfDue();
    this.replaceDatabaseFile(temporaryPath);
  }

  private recoverInterruptedSave() {
    const directory = path.dirname(this.dbPath);
    const baseName = path.basename(this.dbPath);
    fs.mkdirSync(directory, { recursive: true });

    if (fs.existsSync(this.dbPath) && this.isDatabaseFileValid(this.dbPath)) return;

    const backupDirectory = path.join(directory, "backups");
    const localCandidates = fs
      .readdirSync(directory)
      .filter(
        (file) =>
          file === `${baseName}.tmp` ||
          file.startsWith(`${baseName}.previous-`) ||
          (file.startsWith(`${baseName}.`) && file.endsWith(".tmp"))
      )
      .map((file) => path.join(directory, file));
    const backupCandidates = fs.existsSync(backupDirectory)
      ? fs
          .readdirSync(backupDirectory)
          .filter((file) => file.startsWith(`${baseName}.`) && file.endsWith(".sqlite.bak"))
          .map((file) => path.join(backupDirectory, file))
      : [];
    const candidates = [...localCandidates, ...backupCandidates]
      .filter((file) => this.isDatabaseFileValid(file))
      .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);

    const recoverySource = candidates[0];
    if (!recoverySource) {
      if (fs.existsSync(this.dbPath)) throw new Error(`Database integrity check failed: ${this.dbPath}`);
      return;
    }

    if (fs.existsSync(this.dbPath)) {
      fs.renameSync(this.dbPath, `${this.dbPath}.corrupt-${Date.now()}`);
    }
    const recoveryCopy = `${this.dbPath}.recovery-${process.pid}.tmp`;
    fs.copyFileSync(recoverySource, recoveryCopy, fs.constants.COPYFILE_EXCL);
    this.openValidatedDatabase(recoveryCopy).close();
    fs.renameSync(recoveryCopy, this.dbPath);
  }

  private replaceDatabaseFile(temporaryPath: string) {
    const previousPath = `${this.dbPath}.previous-${Date.now()}`;
    const hadPreviousDatabase = fs.existsSync(this.dbPath);
    if (hadPreviousDatabase) fs.renameSync(this.dbPath, previousPath);
    try {
      fs.renameSync(temporaryPath, this.dbPath);
      this.openValidatedDatabase(this.dbPath).close();
      this.pruneFiles(path.dirname(this.dbPath), `${path.basename(this.dbPath)}.previous-`, 1);
    } catch (error) {
      if (fs.existsSync(this.dbPath)) fs.unlinkSync(this.dbPath);
      if (hadPreviousDatabase && fs.existsSync(previousPath)) fs.renameSync(previousPath, this.dbPath);
      throw error;
    }
  }

  private backupDatabaseIfDue() {
    if (!fs.existsSync(this.dbPath) || Date.now() - this.lastBackupAt < 5 * 60 * 1000) return;
    if (!this.isDatabaseFileValid(this.dbPath)) throw new Error(`Refusing to back up an invalid database: ${this.dbPath}`);
    const backupDirectory = path.join(path.dirname(this.dbPath), "backups");
    fs.mkdirSync(backupDirectory, { recursive: true });
    const backupPath = path.join(
      backupDirectory,
      `${path.basename(this.dbPath)}.${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite.bak`
    );
    fs.copyFileSync(this.dbPath, backupPath, fs.constants.COPYFILE_EXCL);
    this.openValidatedDatabase(backupPath).close();
    this.lastBackupAt = Date.now();
    this.pruneFiles(backupDirectory, `${path.basename(this.dbPath)}.`, 3);
  }

  private pruneFiles(directory: string, prefix: string, keep: number) {
    const files = fs
      .readdirSync(directory)
      .filter((file) => file.startsWith(prefix))
      .map((file) => path.join(directory, file))
      .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
    for (const file of files.slice(keep)) fs.unlinkSync(file);
  }

  private openValidatedDatabase(filePath: string) {
    const bytes = fs.readFileSync(filePath);
    this.validateDatabaseBytes(bytes);
    return new (this.requireSql()).Database(bytes);
  }

  private validateDatabaseBytes(bytes: Uint8Array) {
    const validationDatabase = new (this.requireSql()).Database(bytes);
    try {
      const results = validationDatabase.exec("PRAGMA integrity_check");
      const valid = results.length === 1 && results[0].values.every((row) => row[0] === "ok");
      if (!valid) throw new Error("SQLite integrity check failed.");
    } finally {
      validationDatabase.close();
    }
  }

  private isDatabaseFileValid(filePath: string) {
    try {
      this.openValidatedDatabase(filePath).close();
      return true;
    } catch {
      return false;
    }
  }

  private requireSql() {
    if (!this.SQL) throw new Error("SQL.js was not initialized.");
    return this.SQL;
  }

  private requireDb() {
    if (!this.db) {
      throw new Error("Database was not initialized.");
    }
    return this.db;
  }
}
