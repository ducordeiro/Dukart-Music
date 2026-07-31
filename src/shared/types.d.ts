export type DownloadType = "audio" | "video";
export type DownloadStatus = "pending" | "downloading" | "completed" | "failed" | "cancelled";
export interface MediaInfo {
    id?: string;
    title?: string;
    channel?: string;
    duration?: number;
    thumbnail?: string;
    audioSizeBytes?: number | null;
    videoSizeBytes?: number | null;
}
export interface DownloadRecord {
    idDownload: number;
    url: string;
    title: string;
    channel: string;
    type: DownloadType;
    status: DownloadStatus;
    progress: number;
    filePath: string | null;
    fileName: string | null;
    sizeBytes: number | null;
    createdAt: string;
    completedAt: string | null;
    errorMessage: string | null;
}
export interface ProgressPayload {
    idDownload: number;
    type: DownloadType;
    status: DownloadStatus;
    progress: number;
    message?: string;
}
