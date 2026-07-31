/// <reference types="vite/client" />

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

interface EsporteFaiApi {
  authSession: () => Promise<{ user: AuthUser | null }>;
  authRegister: (payload: {
    username: string;
    password: string;
    passwordConfirmation: string;
    acceptedPasswordResponsibility: boolean;
  }) => Promise<AuthResult>;
  authLogin: (payload: { username: string; password: string }) => Promise<AuthResult>;
  authLogout: () => Promise<boolean>;
  loadLibrary: () => Promise<UserLibrarySnapshot>;
  saveLibrary: (playlists: UserPlaylist[], revision: number) => Promise<UserLibrarySaveResult>;
  getMediaInfo: (url: string) => Promise<MediaInfo>;
  searchMusic: (query: string) => Promise<YoutubeSearchResult[]>;
  listDownloads: () => Promise<DownloadRecord[]>;
  findCompleted: (url: string, type?: DownloadType) => Promise<DownloadRecord | null>;
  startDownload: (url: string, type: DownloadType) => Promise<{ idDownload: number; filePath: string }>;
  playFile: (filePath: string) => Promise<boolean>;
  onProgress: (callback: (payload: ProgressPayload) => void) => () => void;
}

declare global {
  interface Window {
    esporteFai?: EsporteFaiApi;
  }
}
