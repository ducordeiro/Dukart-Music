import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import os from "node:os";
import type { AppDatabase } from "./database";
import type { DownloadType, MediaInfo, ProgressPayload } from "../shared/types";

type ProgressHandler = (payload: ProgressPayload) => void;

interface YtDlpFormat {
  acodec?: string;
  vcodec?: string;
  ext?: string;
  height?: number;
  filesize?: number;
  filesize_approx?: number;
}

function runYtDlp(args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const tool = resolveYtDlp();
    const child = spawn(tool, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || stdout || `yt-dlp exited with code ${code}`));
      }
    });
  });
}

export async function readMediaInfo(url: string): Promise<MediaInfo> {
  const { stdout } = await runYtDlp(["--dump-single-json", "--no-playlist", url]);
  const data = JSON.parse(stdout);
  const formats: YtDlpFormat[] = Array.isArray(data.formats) ? data.formats : [];
  const bestAudio = formats
    .filter((format) => format.acodec && format.acodec !== "none" && (!format.vcodec || format.vcodec === "none"))
    .sort((a, b) => Number(b.filesize || b.filesize_approx || 0) - Number(a.filesize || a.filesize_approx || 0))[0];
  const bestVideo = formats
    .filter((format) => format.vcodec && format.vcodec !== "none")
    .sort((a, b) => Number(b.filesize || b.filesize_approx || 0) - Number(a.filesize || a.filesize_approx || 0))[0];
  const progressiveVideo = formats
    .filter(
      (format) =>
        format.ext === "mp4" &&
        format.vcodec &&
        format.vcodec !== "none" &&
        format.acodec &&
        format.acodec !== "none" &&
        Number(format.height || 0) <= 720
    )
    .sort(
      (a, b) =>
        Number(b.height || 0) - Number(a.height || 0) ||
        Number(b.filesize || b.filesize_approx || 0) - Number(a.filesize || a.filesize_approx || 0)
    )[0];

  return {
    id: data.id,
    title: data.title,
    channel: data.channel || data.uploader,
    duration: typeof data.duration === "number" ? data.duration : undefined,
    thumbnail: data.thumbnail,
    audioSizeBytes: Number(bestAudio?.filesize || bestAudio?.filesize_approx || 0) || null,
    videoSizeBytes:
      Number(progressiveVideo?.filesize || progressiveVideo?.filesize_approx || 0) ||
      ((Number(bestVideo?.filesize || bestVideo?.filesize_approx || 0) || 0) +
        (Number(bestAudio?.filesize || bestAudio?.filesize_approx || 0) || 0) ||
        null)
  };
}

export async function downloadMedia(
  db: AppDatabase,
  url: string,
  type: DownloadType,
  downloadsDir: string,
  onProgress?: ProgressHandler,
  onStarted?: (idDownload: number) => void
) {
  const info = await readMediaInfo(url);
  const idMedia = db.upsertMedia(url, info);
  const idDownload = db.createDownload(idMedia, type);
  onStarted?.(idDownload);
  fs.mkdirSync(downloadsDir, { recursive: true });

  const template = path.join(downloadsDir, "%(title).180B-%(id)s.%(ext)s");
  const ffmpegLocation = resolveFfmpegLocation();
  const sharedArgs = ["--no-playlist", "--newline", "--progress", ...ffmpegLocation];
  const args =
    type === "audio"
      ? [
          ...sharedArgs,
          "-f",
          "bestaudio[ext=m4a]/bestaudio",
          "-x",
          "--audio-format",
          "mp3",
          "-o",
          template,
          "--print",
          "after_move:filepath",
          url
        ]
      : [
          ...sharedArgs,
          "-f",
          "best[ext=mp4][vcodec^=avc1][acodec!=none][height<=720]/best[ext=mp4][acodec!=none][height<=720]/best[acodec!=none][height<=720]",
          "--merge-output-format",
          "mp4",
          "-o",
          template,
          "--print",
          "after_move:filepath",
          url
        ];

  return new Promise<{ idDownload: number; filePath: string }>((resolve, reject) => {
    const downloadStartedAt = Date.now();
    const child = spawn(resolveYtDlp(), args, { windowsHide: true });
    let output = "";
    let errorOutput = "";
    let finalPath = "";
    let lastEmittedProgress = -1;
    let lastPersistedProgress = -5;

    const emit = (payload: Omit<ProgressPayload, "idDownload" | "type">) =>
      onProgress?.({ idDownload, type, ...payload });

    const readProgress = (text: string, findFinalPath: boolean) => {
      for (const line of text.split(/\r?\n/)) {
        const percent = line.match(/(\d+(?:\.\d+)?)%/);
        if (percent) {
          const progress = Math.max(0, Math.min(100, Math.floor(Number(percent[1]))));
          if (progress >= lastPersistedProgress + 5 || progress === 100) {
            db.updateProgress(idDownload, progress);
            lastPersistedProgress = progress;
          }
          if (progress !== lastEmittedProgress) {
            emit({ status: "downloading", progress });
            lastEmittedProgress = progress;
          }
        }
        const trimmed = line.trim();
        if (findFinalPath && trimmed && isExpectedDownloadFile(trimmed, info.id, type)) {
          finalPath = trimmed;
        }
      }
    };

    child.stdout.on("data", (data) => {
      const text = data.toString();
      output += text;
      readProgress(text, true);
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      errorOutput += text;
      readProgress(text, false);
    });

    child.on("error", (error) => {
      db.failDownload(idDownload, error.message);
      emit({ status: "failed", progress: 0, message: downloadErrorMessage(error) });
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        const message = errorOutput || output || `yt-dlp exited with code ${code}`;
        db.failDownload(idDownload, message);
        emit({ status: "failed", progress: 0, message: downloadErrorMessage(message) });
        reject(new Error(message));
        return;
      }

      if (!finalPath) {
        finalPath = findDownloadedFile(downloadsDir, info.id, type, downloadStartedAt) || findDownloadedFile(downloadsDir, info.id, type);
      }

      if (!finalPath) {
        const message = `Downloaded file was not found for video ${info.id || "unknown"}.`;
        db.failDownload(idDownload, message);
        emit({ status: "failed", progress: 0, message: downloadErrorMessage(message) });
        reject(new Error(message));
        return;
      }

      const stats = fs.existsSync(finalPath) ? fs.statSync(finalPath) : null;
      const actualDuration = getMediaDurationSeconds(finalPath);
      const expectedDuration = info.duration ?? 0;
      if (!stats?.size || stats.size < 1024 || (expectedDuration > 20 && actualDuration > 0 && actualDuration < expectedDuration * 0.9)) {
        const message = `Downloaded file appears incomplete. Expected about ${Math.round(expectedDuration)}s, got ${Math.round(actualDuration)}s.`;
        db.failDownload(idDownload, message);
        emit({ status: "failed", progress: 0, message: downloadErrorMessage(message) });
        reject(new Error(message));
        return;
      }

      const mimeType = type === "audio" ? "audio/mpeg" : "video/mp4";
      db.completeDownload(idDownload, finalPath, mimeType, stats?.size ?? null);
      emit({ status: "completed", progress: 100 });
      resolve({ idDownload, filePath: finalPath });
    });
  });
}

export function downloadErrorMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error || "");
  const normalized = detail.toLocaleLowerCase("en-US");

  if (
    normalized.includes("httpsconnection") ||
    normalized.includes("unable to download") ||
    normalized.includes("network is unreachable") ||
    normalized.includes("connection refused") ||
    normalized.includes("timed out") ||
    normalized.includes("winerror 10013")
  ) {
    return "Não foi possível acessar o YouTube. Verifique sua conexão e tente novamente.";
  }
  if (normalized.includes("video unavailable") || normalized.includes("private video")) {
    return "Este vídeo não está disponível para download.";
  }
  if (normalized.includes("unsupported url")) {
    return "Este link não é compatível. Use um endereço válido do YouTube.";
  }
  if (normalized.includes("enoent") || normalized.includes("not recognized as an internal or external command")) {
    return "O componente de download não está disponível no servidor.";
  }
  if (normalized.includes("appears incomplete")) {
    return "O arquivo recebido parece incompleto. Tente fazer o download novamente.";
  }
  if (normalized.includes("downloaded file was not found")) {
    return "O download terminou, mas o arquivo não foi localizado. Tente novamente.";
  }
  return "Não foi possível concluir o download. Tente novamente em alguns instantes.";
}

function findDownloadedFile(dir: string, expectedId: string | undefined, type: DownloadType, startedAtMs?: number) {
  const files = fs
    .readdirSync(dir)
    .map((file) => path.join(dir, file))
    .filter((file) => isExpectedDownloadFile(file, expectedId, type, startedAtMs))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] ?? "";
}

function isExpectedDownloadFile(filePath: string, expectedId: string | undefined, type: DownloadType, minMtimeMs?: number) {
  if (!filePath || !fs.existsSync(filePath)) return false;

  const stats = fs.statSync(filePath);
  if (!stats.isFile()) return false;
  if (minMtimeMs && stats.mtimeMs < minMtimeMs - 5000) return false;

  const extension = path.extname(filePath).toLowerCase();
  if (type === "audio" && extension !== ".mp3") return false;
  if (type === "video" && extension !== ".mp4") return false;

  return !expectedId || path.basename(filePath).includes(expectedId);
}

function resolveYtDlp() {
  const executable = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  return resolveCommand(executable, [
    process.env.ESPORTE_FAI_YTDLP_PATH || "",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "yt-dlp.exe") : "",
    path.join(
      os.homedir(),
      "AppData",
      "Local",
      "Microsoft",
      "WinGet",
      "Packages",
      "yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe",
      "yt-dlp.exe"
    )
  ]);
}

function resolveFfmpegLocation() {
  const executable = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const ffmpeg = resolveCommand(executable, [
    process.env.ESPORTE_FAI_FFMPEG_PATH || "",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "ffmpeg.exe") : "",
    path.join(
      os.homedir(),
      "AppData",
      "Local",
      "Microsoft",
      "WinGet",
      "Packages",
      "yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe",
      "ffmpeg-N-124716-g054dffd133-win64-gpl",
      "bin",
      "ffmpeg.exe"
    )
  ]);

  return ffmpeg === executable ? [] : ["--ffmpeg-location", path.dirname(ffmpeg)];
}

function getMediaDurationSeconds(filePath: string) {
  if (!filePath || !fs.existsSync(filePath)) {
    return 0;
  }

  try {
    const ffprobe = resolveFfprobe();
    const output = execFileSync(
      ffprobe,
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      { windowsHide: true, encoding: "utf8" }
    );
    return Number.parseFloat(output.trim()) || 0;
  } catch {
    return 0;
  }
}

function resolveFfprobe() {
  const executable = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
  return resolveCommand(executable, [
    process.env.ESPORTE_FAI_FFPROBE_PATH || "",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "ffprobe.exe") : "",
    path.join(
      os.homedir(),
      "AppData",
      "Local",
      "Microsoft",
      "WinGet",
      "Packages",
      "yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe",
      "ffmpeg-N-124716-g054dffd133-win64-gpl",
      "bin",
      "ffprobe.exe"
    )
  ]);
}

function resolveCommand(executable: string, fallbacks: string[]) {
  for (const fallback of fallbacks) {
    if (fallback && fs.existsSync(fallback)) {
      return fallback;
    }
  }

  try {
    const where = process.platform === "win32" ? "where.exe" : "which";
    const output = execFileSync(where, [executable], { windowsHide: true, encoding: "utf8" });
    const command = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return command || executable;
  } catch {
    return executable;
  }
}
