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
  checksumSha256?: string | null;
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

export interface YoutubeSearchResult {
  videoId: string;
  titulo: string;
  canal: string;
  thumbnail: string;
}

export interface AuthUser {
  idUser: number;
  username: string;
}

export interface AuthResult {
  user: AuthUser;
}

export interface UserPlaylistTrack {
  key: string;
  url: string;
  title: string;
  channel: string;
  type: DownloadType;
}

export interface UserPlaylist {
  id: string;
  name: string;
  itemIds: number[];
  items?: UserPlaylistTrack[];
  special?: "liked";
  coverImage?: string;
  createdAt: string;
}

export interface UserLibrarySnapshot {
  playlists: UserPlaylist[] | null;
  revision: number;
}

export type UserLibrarySaveResult =
  | {
      ok: true;
      library: UserLibrarySnapshot;
    }
  | {
      ok: false;
      conflict: true;
      library: UserLibrarySnapshot;
    };
