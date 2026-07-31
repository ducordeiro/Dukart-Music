import type { DownloadRecord } from "../shared/types";
import { isSupportedYoutubeUrl } from "../shared/youtube";

export function isValidUrl(value: string) {
  return isSupportedYoutubeUrl(value);
}

export function formatMb(bytes?: number | null) {
  if (bytes === undefined || bytes === null) return "** MB";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "00:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function streamUrl(track?: DownloadRecord | null) {
  if (!track) return "";
  if (window.esporteFai) return `esporte-fai-media://download/${track.idDownload}`;
  return `/api/files/${track.idDownload}/stream`;
}

export function offlineUrlById(idDownload: number, idUser?: number) {
  return idUser === undefined ? `/offline-media/${idDownload}` : `/offline-media/${idUser}/${idDownload}`;
}

export function offlineUrl(track?: DownloadRecord | null, idUser?: number) {
  if (!track || track.type !== "audio" || window.esporteFai) return "";
  return offlineUrlById(track.idDownload, idUser);
}

export function youtubeUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function readPlaylistCover(file: File) {
  return new Promise<string>((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Escolha um arquivo de imagem."));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Nao foi possivel ler a imagem."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Nao foi possivel carregar a imagem."));
      image.onload = () => {
        const size = 320;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Nao foi possivel preparar a capa."));
          return;
        }

        const sourceSize = Math.min(image.width, image.height);
        const sourceX = Math.max(0, (image.width - sourceSize) / 2);
        const sourceY = Math.max(0, (image.height - sourceSize) / 2);
        context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      image.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}
