import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  AuthUser,
  DownloadRecord,
  DownloadStatus,
  DownloadType,
  UserLibrarySnapshot,
  UserPlaylistTrack,
  YoutubeSearchResult
} from "../shared/types";
import {
  mergeUserPlaylists,
  playlistContainsDownload,
  playlistTrackFromDownload,
  playlistTrackKey
} from "../shared/userLibrary";
import { api, ApiError } from "./api";
import { AuthView } from "./AuthView";
import { BottomNavigation, BottomSheet, HomeView, Modal, PlayerReturnTab, PlayerView, PlaylistDetailView, PlaylistsView, QueueSheet, SearchView, SettingsView } from "./components";
import { LIKED_ID, THEME_KEY } from "./constants";
import { hasLegacyLibrary, likedPlaylist, loadLegacyLibrary, removeLegacyLibrary } from "./library";
import {
  mergeOfflineRecords,
  persistOfflineAudioIds,
  pruneMissingOfflineAudioIds,
  readOfflineAudioIds,
  readOfflineRecords,
  registerServiceWorker,
  removeTrackOffline,
  saveTrackOffline,
  upsertOfflineRecord
} from "./offlineMedia";
import type { Status, UserPlaylist, View } from "./types";
import { isValidUrl, offlineUrl, readPlaylistCover, streamUrl, youtubeUrl } from "./utils";
import "./styles.css";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface DownloadTask {
  idDownload: number;
  url: string;
  title: string;
  type: DownloadType;
  status: DownloadStatus;
  progress: number;
  message?: string;
}

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let installedFromBrowserEvent = false;

// Capture this event as soon as the application bundle is evaluated. Waiting
// for React effects can miss it on fast loads or when the service worker is
// already active.
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event as BeforeInstallPromptEvent;
  window.dispatchEvent(new Event("pwa-install-available"));
});

window.addEventListener("appinstalled", () => {
  installedFromBrowserEvent = true;
  deferredInstallPrompt = null;
  window.dispatchEvent(new Event("pwa-install-complete"));
});

function isRunningAsInstalledApp() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

function isIOSDevice() {
  const platform = navigator.platform || "";
  const userAgent = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function recentSearchStorageKey(idUser: number) {
  return `esporte-fai:recent-searches:${idUser}`;
}

const CACHED_USER_KEY = "esporte-fai:cached-user";

function libraryCacheKey(idUser: number) {
  return `esporte-fai:library:${idUser}`;
}

function queueStorageKey(idUser: number) {
  return `esporte-fai:queue:${idUser}`;
}

function readCachedUser(): AuthUser | null {
  try {
    const user = JSON.parse(localStorage.getItem(CACHED_USER_KEY) || "null") as AuthUser | null;
    return user && Number.isSafeInteger(user.idUser) && typeof user.username === "string" ? user : null;
  } catch {
    return null;
  }
}

function cacheAuthenticatedUser(user: AuthUser) {
  localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
}

function readCachedLibrary(idUser: number): UserLibrarySnapshot | null {
  try {
    const snapshot = JSON.parse(localStorage.getItem(libraryCacheKey(idUser)) || "null") as UserLibrarySnapshot | null;
    return snapshot && Number.isSafeInteger(snapshot.revision) && (snapshot.playlists === null || Array.isArray(snapshot.playlists)) ? snapshot : null;
  } catch {
    return null;
  }
}

function readRecentSearches(idUser: number): YoutubeSearchResult[] {
  try {
    const value = JSON.parse(localStorage.getItem(recentSearchStorageKey(idUser)) || "[]");
    return Array.isArray(value)
      ? value.filter((item) => item && typeof item.videoId === "string" && typeof item.titulo === "string").slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

function AuthenticatedApp({ authUser, onLogout }: { authUser: AuthUser; onLogout: () => Promise<void> }) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const musicSearchBusyRef = useRef(false);
  const desiredPlaybackRef = useRef(false);
  const [url, setUrl] = useState("");
  const [musicSearch, setMusicSearch] = useState("");
  const [musicResults, setMusicResults] = useState<YoutubeSearchResult[]>([]);
  const [musicSearchLoading, setMusicSearchLoading] = useState(false);
  const [musicSearchError, setMusicSearchError] = useState("");
  const [selectedMusic, setSelectedMusic] = useState<YoutubeSearchResult | null>(null);
  const [recentSearches, setRecentSearches] = useState<YoutubeSearchResult[]>(() => readRecentSearches(authUser.idUser));
  const [playableDownload, setPlayableDownload] = useState<DownloadRecord | null>(null);
  const [view, setView] = useState<View>("main");
  const [previousView, setPreviousView] = useState<View>("playlists");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(LIKED_ID);
  const [audioSize, setAudioSize] = useState<number | null>(null);
  const [videoSize, setVideoSize] = useState<number | null>(null);
  const [status, setStatus] = useState<Record<DownloadType | "play", Status>>({ audio: "idle", video: "idle", play: "idle" });
  const [progress, setProgress] = useState<Record<DownloadType, number>>({ audio: 0, video: 0 });
  const [message, setMessage] = useState("");
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);
  const [downloadTasks, setDownloadTasks] = useState<DownloadTask[]>([]);
  const [playlists, setPlaylists] = useState<UserPlaylist[]>(() => [likedPlaylist()]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryLoadError, setLibraryLoadError] = useState("");
  const [libraryLoadAttempt, setLibraryLoadAttempt] = useState(0);
  const libraryLoadPromiseRef = useRef<Promise<UserLibrarySnapshot> | null>(null);
  const librarySaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const librarySaveTimerRef = useRef<number | null>(null);
  const playlistsRef = useRef(playlists);
  const libraryBaseRef = useRef<UserPlaylist[]>(playlists);
  const libraryRevisionRef = useRef(0);
  const skipNextLibrarySaveRef = useRef(false);
  const [queue, setQueue] = useState<DownloadRecord[]>([]);
  const queueHydratedRef = useRef(false);
  const [currentTrack, setCurrentTrack] = useState<DownloadRecord | null>(null);
  const [queueArtwork, setQueueArtwork] = useState("");
  const [playbackMediaUrl, setPlaybackMediaUrl] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [newPlaylistTrack, setNewPlaylistTrack] = useState<DownloadRecord | null>(null);
  const [playlistDraft, setPlaylistDraft] = useState("");
  const [sheetSelection, setSheetSelection] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [repeatQueue, setRepeatQueue] = useState(false);
  const [settingsHistoryLoaded, setSettingsHistoryLoaded] = useState(false);
  const [settingsHistoryDownloads, setSettingsHistoryDownloads] = useState<DownloadRecord[]>([]);
  const [settingsHistoryLoading, setSettingsHistoryLoading] = useState(false);
  const [settingsHistoryError, setSettingsHistoryError] = useState("");
  const [fileDownloadBusyId, setFileDownloadBusyId] = useState<number | null>(null);
  const [allBlack, setAllBlack] = useState(() => localStorage.getItem(THEME_KEY) === "true");
  const [offlineAudioIds, setOfflineAudioIds] = useState<number[]>(() => readOfflineAudioIds(authUser.idUser));
  const [offlineBusyId, setOfflineBusyId] = useState<number | null>(null);
  const [offlinePlaylistProgress, setOfflinePlaylistProgress] = useState<{
    mode: "saving" | "removing";
    completed: number;
    total: number;
    receivedBytes?: number;
    totalBytes?: number;
  } | null>(null);
  const offlinePlaylistAbortRef = useRef<AbortController | null>(null);
  const [syncedDownloadBusyKey, setSyncedDownloadBusyKey] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(() => deferredInstallPrompt);
  const [appInstalled, setAppInstalled] = useState(() => installedFromBrowserEvent || isRunningAsInstalledApp());
  const [installingApp, setInstallingApp] = useState(false);
  const [installHelp, setInstallHelp] = useState<"ios" | "browser" | null>(null);

  const validUrl = useMemo(() => isValidUrl(url), [url]);
  const completedDownloads = useMemo(() => downloads.filter((item) => item.status === "completed" && item.filePath), [downloads]);
  const recentTracks = useMemo(
    () => [...completedDownloads].sort((left, right) => Date.parse(right.completedAt || right.createdAt) - Date.parse(left.completedAt || left.createdAt)).slice(0, 4),
    [completedDownloads]
  );
  const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId) || playlists[0] || likedPlaylist();
  const selectedTracks = useMemo(() => {
    const byKey = new Map(completedDownloads.map((item) => [playlistTrackKey(item.url, item.type), item]));
    if (selectedPlaylist.items?.length) {
      return selectedPlaylist.items.map((item) => byKey.get(item.key)).filter((item): item is DownloadRecord => Boolean(item));
    }
    const byId = new Map(completedDownloads.map((item) => [item.idDownload, item]));
    return selectedPlaylist.itemIds.map((id) => byId.get(id)).filter((item): item is DownloadRecord => Boolean(item));
  }, [completedDownloads, selectedPlaylist]);
  const selectedTrackKeys = new Set(selectedTracks.map((track) => playlistTrackKey(track.url, track.type)));
  const unavailableSyncedTracks = (selectedPlaylist.items || []).filter((item) => !selectedTrackKeys.has(item.key));
  const selectedAudioTracks = selectedTracks.filter((track) => track.type === "audio");
  const unavailableSyncedAudioTracks = unavailableSyncedTracks.filter((track) => track.type === "audio");
  const playlistOfflineTotal = selectedAudioTracks.length + unavailableSyncedAudioTracks.length;
  const playlistOfflineSaved = selectedAudioTracks.filter((track) => offlineAudioIds.includes(track.idDownload)).length;
  const playlistOfflineComplete =
    playlistOfflineTotal > 0 &&
    unavailableSyncedAudioTracks.length === 0 &&
    playlistOfflineSaved === selectedAudioTracks.length;
  const filteredTracks = selectedTracks.filter((item) => {
    const needle = `${item.title} ${item.channel}`.toLowerCase();
    return needle.includes(search.toLowerCase());
  });
  const filteredSyncedTracks = unavailableSyncedTracks.filter((item) => {
    const needle = `${item.title} ${item.channel}`.toLowerCase();
    return needle.includes(search.toLowerCase());
  });
  const liked = playlists.find((playlist) => playlist.id === LIKED_ID);
  const isFavorite = currentTrack && liked ? playlistContainsDownload(liked, currentTrack) : false;

  useEffect(() => {
    if (queueHydratedRef.current || !completedDownloads.length) return;
    queueHydratedRef.current = true;
    try {
      const ids = JSON.parse(localStorage.getItem(queueStorageKey(authUser.idUser)) || "[]") as number[];
      const byId = new Map(completedDownloads.map((track) => [track.idDownload, track]));
      setQueue(ids.map((id) => byId.get(id)).filter((track): track is DownloadRecord => Boolean(track)));
    } catch {
      setQueue([]);
    }
  }, [authUser.idUser, completedDownloads]);

  useEffect(() => {
    if (!queueHydratedRef.current) return;
    localStorage.setItem(queueStorageKey(authUser.idUser), JSON.stringify(queue.map((track) => track.idDownload)));
  }, [authUser.idUser, queue]);

  useEffect(() => {
    localStorage.setItem(recentSearchStorageKey(authUser.idUser), JSON.stringify(recentSearches));
  }, [authUser.idUser, recentSearches]);

  useEffect(() => {
    let active = true;
    setLibraryLoaded(false);
    setLibraryLoadError("");

    if (!libraryLoadPromiseRef.current) {
      libraryLoadPromiseRef.current = (async () => {
        let storedLibrary: UserLibrarySnapshot;
        try {
          storedLibrary = await api.loadLibrary();
          localStorage.setItem(libraryCacheKey(authUser.idUser), JSON.stringify(storedLibrary));
        } catch (error) {
          const cached = readCachedLibrary(authUser.idUser);
          if (!cached) throw error;
          setMessage("Modo offline: exibindo a biblioteca salva neste aparelho.");
          return cached;
        }
        if (storedLibrary.playlists) return storedLibrary;

        const shouldMigrateLegacyLibrary = hasLegacyLibrary();
        const initialPlaylists = shouldMigrateLegacyLibrary ? loadLegacyLibrary() : [likedPlaylist()];
        let basePlaylists = [likedPlaylist()];
        let candidate = initialPlaylists;
        let revision = storedLibrary.revision;
        let savedLibrary: UserLibrarySnapshot | null = null;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const result = await api.saveLibrary(candidate, revision);
          if (result.ok) {
            savedLibrary = result.library;
            break;
          }
          const remotePlaylists = result.library.playlists || [likedPlaylist()];
          candidate = mergeUserPlaylists(basePlaylists, candidate, remotePlaylists);
          basePlaylists = remotePlaylists;
          revision = result.library.revision;
        }
        if (!savedLibrary) throw new Error("A biblioteca mudou repetidamente em outro dispositivo. Tente novamente.");
        if (shouldMigrateLegacyLibrary) removeLegacyLibrary();
        return savedLibrary;
      })();
    }

    libraryLoadPromiseRef.current
      .then((accountLibrary) => {
        if (!active) return;
        const accountPlaylists = accountLibrary.playlists || [likedPlaylist()];
        libraryRevisionRef.current = accountLibrary.revision;
        libraryBaseRef.current = accountPlaylists;
        playlistsRef.current = accountPlaylists;
        skipNextLibrarySaveRef.current = true;
        setPlaylists(accountPlaylists);
        setSelectedPlaylistId(LIKED_ID);
        setLibraryLoaded(true);
      })
      .catch((error) => {
        if (!active) return;
        libraryLoadPromiseRef.current = null;
        setLibraryLoadError(error instanceof Error ? error.message : "Nao foi possivel carregar sua biblioteca.");
      });

    return () => {
      active = false;
    };
  }, [authUser.idUser, libraryLoadAttempt]);

  useEffect(() => {
    refreshDownloads();

    let cancelled = false;
    pruneMissingOfflineAudioIds(authUser.idUser)
      .then((verifiedIds) => {
        if (!cancelled) {
          setOfflineAudioIds(verifiedIds);
          setDownloads((current) => mergeOfflineRecords(current, authUser.idUser));
        }
      })
      .catch(() => {
        if (!cancelled) setOfflineAudioIds([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const exposeCapturedPrompt = () => {
      setInstallPrompt(deferredInstallPrompt);
      setInstallHelp(null);
    };
    const confirmInstallation = () => {
      setAppInstalled(true);
      setInstallingApp(false);
      setInstallPrompt(null);
      setMessage("Esporte Fai instalado com sucesso.");
    };

    exposeCapturedPrompt();
    window.addEventListener("pwa-install-available", exposeCapturedPrompt);
    window.addEventListener("pwa-install-complete", confirmInstallation);
    return () => {
      window.removeEventListener("pwa-install-available", exposeCapturedPrompt);
      window.removeEventListener("pwa-install-complete", confirmInstallation);
    };
  }, []);

  useEffect(() => {
    if (!libraryLoaded) return;
    playlistsRef.current = playlists;
    if (skipNextLibrarySaveRef.current) {
      skipNextLibrarySaveRef.current = false;
      return;
    }
    if (librarySaveTimerRef.current) window.clearTimeout(librarySaveTimerRef.current);
    librarySaveTimerRef.current = window.setTimeout(() => {
      librarySaveTimerRef.current = null;
      enqueueLibrarySave();
    }, 600);
    return () => {
      if (librarySaveTimerRef.current) window.clearTimeout(librarySaveTimerRef.current);
    };
  }, [libraryLoaded, playlists]);

  function enqueueLibrarySave() {
    const saveOperation = librarySaveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        const localAtStart = playlistsRef.current;
        const committed = await commitLibrary(localAtStart);
        const current = playlistsRef.current;
        const rebased = librariesEqual(current, localAtStart)
          ? committed
          : mergeUserPlaylists(localAtStart, current, committed);
        if (!librariesEqual(current, rebased)) {
          skipNextLibrarySaveRef.current = true;
          playlistsRef.current = rebased;
          setPlaylists(rebased);
        }
      });
    librarySaveChainRef.current = saveOperation;
    void saveOperation.catch(() => {
      setMessage("Nao foi possivel salvar as alteracoes da sua conta.");
    });
    return saveOperation;
  }

  function flushPendingLibrarySave() {
    if (librarySaveTimerRef.current) {
      window.clearTimeout(librarySaveTimerRef.current);
      librarySaveTimerRef.current = null;
      return enqueueLibrarySave();
    }
    return librarySaveChainRef.current;
  }

  useEffect(() => {
    if (!libraryLoaded || !downloads.length) return;
    setPlaylists((current) =>
      current.map((playlist) => {
        if (playlist.items !== undefined) return playlist;
        const matchedDownloads = playlist.itemIds
          .map((idDownload) => downloads.find((download) => download.idDownload === idDownload))
          .filter((download): download is DownloadRecord => Boolean(download));
        if (matchedDownloads.length !== new Set(playlist.itemIds).size) return playlist;
        return {
          ...playlist,
          items: matchedDownloads.map(playlistTrackFromDownload)
        };
      })
    );
  }, [downloads, libraryLoaded]);

  useEffect(() => {
    if (!libraryLoaded) return;
    let cancelled = false;

    const refreshAccountLibrary = async () => {
      try {
        await flushPendingLibrarySave();
        const remoteLibrary = await api.loadLibrary();
        if (cancelled || remoteLibrary.revision === libraryRevisionRef.current) return;

        const base = libraryBaseRef.current;
        const local = playlistsRef.current;
        const remote = remoteLibrary.playlists || [likedPlaylist()];
        const merged = mergeUserPlaylists(base, local, remote);
        const hasUnsavedLocalChanges = !librariesEqual(local, base);
        libraryRevisionRef.current = remoteLibrary.revision;
        libraryBaseRef.current = remote;

        if (!librariesEqual(merged, local)) {
          skipNextLibrarySaveRef.current = !hasUnsavedLocalChanges;
          playlistsRef.current = merged;
          setPlaylists(merged);
        }
      } catch {
        // A gravacao local ja exibe erros; a sincronizacao sera tentada novamente.
      }
    };

    const handleFocus = () => void refreshAccountLibrary();
    const interval = window.setInterval(refreshAccountLibrary, 15_000);
    window.addEventListener("focus", handleFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [libraryLoaded]);

  async function commitLibrary(localPlaylists: UserPlaylist[]) {
    let candidate = localPlaylists;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const base = libraryBaseRef.current;
      const result = await api.saveLibrary(candidate, libraryRevisionRef.current);
      if (result.ok) {
        const committed = result.library.playlists || candidate;
        libraryRevisionRef.current = result.library.revision;
        libraryBaseRef.current = committed;
        localStorage.setItem(libraryCacheKey(authUser.idUser), JSON.stringify(result.library));
        return committed;
      }

      const remote = result.library.playlists || [likedPlaylist()];
      candidate = mergeUserPlaylists(base, candidate, remote);
      libraryRevisionRef.current = result.library.revision;
      libraryBaseRef.current = remote;
    }
    throw new Error("A biblioteca mudou repetidamente em outro dispositivo. Tente novamente.");
  }

  useEffect(() => {
    persistOfflineAudioIds(offlineAudioIds, authUser.idUser);
  }, [authUser.idUser, offlineAudioIds]);

  useEffect(() => {
    document.body.classList.toggle("theme-all-black", allBlack);
    localStorage.setItem(THEME_KEY, String(allBlack));
  }, [allBlack]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !currentTrack) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.channel || "Esporte Fai",
      album: "Esporte Fai"
    });

    const play = () => {
      const media = mediaRef.current;
      if (!media) return;
      desiredPlaybackRef.current = true;
      void media.play().catch(() => {
        setIsPlaying(false);
        setMessage("Não foi possível continuar a reprodução em segundo plano.");
      });
    };
    const pause = () => {
      desiredPlaybackRef.current = false;
      mediaRef.current?.pause();
    };
    const seekTo = (details: MediaSessionActionDetails) => {
      const media = mediaRef.current;
      if (!media || details.seekTime === undefined) return;
      media.currentTime = Math.max(0, Math.min(details.seekTime, Number.isFinite(media.duration) ? media.duration : details.seekTime));
    };

    navigator.mediaSession.setActionHandler("play", play);
    navigator.mediaSession.setActionHandler("pause", pause);
    navigator.mediaSession.setActionHandler("previoustrack", previousTrack);
    navigator.mediaSession.setActionHandler("nexttrack", nextTrack);
    navigator.mediaSession.setActionHandler("seekto", seekTo);

    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
      navigator.mediaSession.setActionHandler("seekto", null);
    };
  }, [currentTrack, queue, repeatQueue]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    if (!duration || !Number.isFinite(duration)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: mediaRef.current?.playbackRate || 1,
        position: Math.max(0, Math.min(currentTime, duration))
      });
    } catch {
      // Some browsers expose Media Session without position-state support.
    }
  }, [currentTime, duration, isPlaying]);

  useEffect(() => {
    if (!currentTrack || window.esporteFai) return;

    const audioSessionNavigator = navigator as Navigator & { audioSession?: { type: string } };
    if (audioSessionNavigator.audioSession) {
      audioSessionNavigator.audioSession.type = "playback";
    }

    const keepPlaybackAlive = () => {
      const media = mediaRef.current;
      if (!desiredPlaybackRef.current || !media || media.ended || !media.paused) return;
      void media.play().catch(() => undefined);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") keepPlaybackAlive();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", keepPlaybackAlive);
    window.addEventListener("pageshow", keepPlaybackAlive);
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === "hidden") keepPlaybackAlive();
    }, 1500);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", keepPlaybackAlive);
      window.removeEventListener("pageshow", keepPlaybackAlive);
      window.clearInterval(heartbeat);
    };
  }, [currentTrack]);

  useEffect(() => {
    return api.onProgress((payload) => {
      setDownloadTasks((current) => upsertDownloadTask(current, { ...payload, url: current.find((item) => item.idDownload === payload.idDownload)?.url || "", title: current.find((item) => item.idDownload === payload.idDownload)?.title || "Download" }));
      setProgress((current) => ({ ...current, [payload.type]: payload.progress }));
      if (payload.status === "completed") {
        setStatus((current) => ({ ...current, [payload.type]: "completed" }));
        setMessage("Download concluido.");
        refreshDownloads();
      }
      if (payload.status === "failed") {
        setStatus((current) => ({ ...current, [payload.type]: "failed" }));
        setMessage(payload.message || "Falha no download.");
      }
      if (payload.status === "cancelled") setMessage("Download cancelado.");
    });
  }, []);

  useEffect(() => {
    setAudioSize(null);
    setVideoSize(null);
    if (!validUrl) return;

    const timeout = window.setTimeout(async () => {
      try {
        const info = await api.getMediaInfo(url);
        setAudioSize(info.audioSizeBytes ?? null);
        setVideoSize(info.videoSizeBytes ?? null);
      } catch {
        setAudioSize(null);
        setVideoSize(null);
      }
    }, 550);

    return () => window.clearTimeout(timeout);
  }, [url, validUrl]);

  useEffect(() => {
    let cancelled = false;
    setPlayableDownload(null);
    if (!validUrl) return;

    api
      .findCompleted(url)
      .then((record) => {
        if (!cancelled) {
          setPlayableDownload(record?.filePath ? record : null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlayableDownload(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url, validUrl, downloads]);

  useEffect(() => {
    if (!mediaRef.current || !currentTrack) return;
    setCurrentTime(0);
    setDuration(0);
    mediaRef.current.load();
    mediaRef.current
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => {
        setIsPlaying(false);
        setMessage("Toque em Play para iniciar.");
      });
  }, [currentTrack]);

  async function refreshDownloads() {
    try {
      const records = await api.listDownloads();
      setDownloads(mergeOfflineRecords(records, authUser.idUser));
    } catch {
      const offlineRecords = readOfflineRecords(authUser.idUser);
      setDownloads(offlineRecords);
      if (offlineRecords.length) {
        setMessage("Sem conexao com o backend. Mostrando musicas salvas offline neste aparelho.");
      } else {
        setMessage("Nao foi possivel carregar a biblioteca agora.");
      }
    }
  }

  async function searchMusicByName() {
    const query = musicSearch.trim();
    if (!query) {
      setMusicSearchError("Digite o nome da musica.");
      setMusicResults([]);
      return;
    }
    if (isValidUrl(query)) {
      updateUrl(query);
      setMusicResults([]);
      setMusicSearchError("");
      setMessage("Link reconhecido. Escolha tocar, baixar áudio ou baixar vídeo.");
      return;
    }
    if (musicSearchBusyRef.current) return;

    try {
      musicSearchBusyRef.current = true;
      setMusicSearchLoading(true);
      setMusicSearchError("");
      const results = await api.searchMusic(query);
      setMusicResults(results);
      if (!results.length) {
        setMusicSearchError("Nenhum resultado encontrado.");
      }
    } catch (error) {
      console.warn(error);
      const message = error instanceof Error ? error.message : "";
      setMusicSearchError(
        message.includes("YOUTUBE_API_KEY") || message.toLowerCase().includes("nao configurada")
          ? "Busca do YouTube ainda nao configurada no backend."
          : "Nao foi possivel buscar musicas agora. Tente novamente mais tarde."
      );
    } finally {
      musicSearchBusyRef.current = false;
      setMusicSearchLoading(false);
    }
  }

  function selectMusic(result: YoutubeSearchResult) {
    setSelectedMusic(result);
    setRecentSearches((current) => [result, ...current.filter((item) => item.videoId !== result.videoId)].slice(0, 8));
    setUrl(youtubeUrl(result.videoId));
    setMusicSearchError("");
    setMessage(`Selecionado: ${result.titulo}`);
  }

  function updateUrl(value: string) {
    setSelectedMusic(null);
    setUrl(value);
  }

  function updateSmartSearch(value: string) {
    setMusicSearch(value);
    if (isValidUrl(value.trim())) {
      updateUrl(value.trim());
    } else if (selectedMusic && !value.toLowerCase().includes(selectedMusic.titulo.toLowerCase())) {
      setSelectedMusic(null);
      setUrl("");
    }
  }

  async function playSearchResult(result: YoutubeSearchResult) {
    if (musicSearchBusyRef.current) return;
    const targetUrl = youtubeUrl(result.videoId);
    selectMusic(result);
    try {
      musicSearchBusyRef.current = true;
      setMessage(`Preparando ${result.titulo}...`);
      let record = await api.findCompleted(targetUrl, "audio");
      if (!record?.filePath) {
        setStatus((current) => ({ ...current, audio: "loading" }));
        setProgress((current) => ({ ...current, audio: 0 }));
        const started = await api.startDownload(targetUrl, "audio");
        setDownloadTasks((current) => upsertDownloadTask(current, { idDownload: started.idDownload, url: targetUrl, title: result.titulo, type: "audio", status: started.filePath ? "completed" : "downloading", progress: started.filePath ? 100 : 0 }));
        if (!window.esporteFai && !started.filePath) await waitForWebDownload(started.idDownload, "audio");
        record = await api.findCompleted(targetUrl, "audio");
      }
      if (!record?.filePath) throw new Error("O áudio terminou de baixar, mas ainda não está disponível.");
      await refreshDownloads();
      setStatus((current) => ({ ...current, audio: "completed", play: "playing" }));
      startQueue([record], 0, true, "");
    } catch (error) {
      setStatus((current) => ({ ...current, audio: "failed" }));
      setMessage(error instanceof Error ? error.message : "Não foi possível preparar esta música.");
    } finally {
      musicSearchBusyRef.current = false;
    }
  }

  async function startDownload(type: DownloadType, targetUrl = url, taskTitle = selectedMusic?.titulo || targetUrl) {
    if (!isValidUrl(targetUrl)) return;

    try {
      const existing = await api.findCompleted(targetUrl, type);
      if (existing?.filePath) {
        const openExisting = window.confirm("Este link ja foi baixado. Reproduzir o arquivo existente?");
        if (openExisting) {
          startQueue([existing], 0, true, "");
          return;
        }
      }

      setStatus((current) => ({ ...current, [type]: "loading" }));
      setProgress((current) => ({ ...current, [type]: 0 }));
      setMessage(type === "audio" ? "Baixando audio..." : "Baixando audio e video...");
      const startedDownload = await api.startDownload(targetUrl, type);
      setDownloadTasks((current) => upsertDownloadTask(current, { idDownload: startedDownload.idDownload, url: targetUrl, title: taskTitle, type, status: startedDownload.filePath ? "completed" : "downloading", progress: startedDownload.filePath ? 100 : 0 }));
      if (!window.esporteFai && !startedDownload.filePath) {
        await waitForWebDownload(startedDownload.idDownload, type);
      }
      setStatus((current) => ({ ...current, [type]: "completed" }));
      setProgress((current) => ({ ...current, [type]: 100 }));
      setMessage("Download salvo na biblioteca.");
      await refreshDownloads();
    } catch (error) {
      setStatus((current) => ({ ...current, [type]: "failed" }));
      setMessage(error instanceof Error ? error.message : "Falha no download.");
    }
  }

  async function downloadSyncedTrack(track: UserPlaylistTrack) {
    if (syncedDownloadBusyKey) return;
    try {
      setSyncedDownloadBusyKey(track.key);
      setMessage(`Baixando ${track.title} neste dispositivo...`);
      const existing = await api.findCompleted(track.url, track.type);
      if (!existing?.filePath) {
        const startedDownload = await api.startDownload(track.url, track.type);
        if (!window.esporteFai && !startedDownload.filePath) {
          await waitForWebDownload(startedDownload.idDownload, track.type);
        }
      }
      await refreshDownloads();
      setMessage("Musica disponivel neste dispositivo.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao baixar a musica sincronizada.");
    } finally {
      setSyncedDownloadBusyKey(null);
    }
  }

  async function waitForWebDownload(idDownload: number, type: DownloadType) {
    const deadline = Date.now() + 2 * 60 * 60 * 1000;
    let transientFailures = 0;

    while (Date.now() < deadline) {
      try {
        const payload = await api.getDownloadProgress(idDownload);
        if (!payload) throw new Error("Download não encontrado.");
        transientFailures = 0;
        setProgress((current) => ({ ...current, [type]: Math.max(0, Math.min(100, payload.progress || 0)) }));
        setDownloadTasks((current) => {
          const existing = current.find((item) => item.idDownload === idDownload);
          return existing ? upsertDownloadTask(current, { ...existing, status: payload.status, progress: payload.progress || 0, message: "message" in payload ? payload.message : undefined }) : current;
        });

        if (payload.status === "completed") return;
        if (payload.status === "failed" || payload.status === "cancelled") {
          const message = "message" in payload ? payload.message : undefined;
          const terminalError = new Error(message || "Não foi possível concluir o download.") as Error & { terminal: boolean };
          terminalError.terminal = true;
          throw terminalError;
        }
      } catch (error) {
        transientFailures += 1;
        const typedError = error as { status?: number; terminal?: boolean };
        if (typedError.status === 401 || typedError.terminal) {
          throw error;
        }
      }

      await new Promise((resolve) => window.setTimeout(resolve, Math.min(5_000, 700 * Math.max(1, transientFailures))));
    }

    throw new Error("O download demorou mais que o esperado. Consulte o histórico em alguns minutos.");
  }

  async function cancelDownloadTask(task: DownloadTask) {
    try {
      await api.cancelDownload(task.idDownload);
      setDownloadTasks((current) => upsertDownloadTask(current, { ...task, status: "cancelled" }));
      setMessage("Download cancelado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível cancelar o download.");
    }
  }

  async function retryDownloadTask(task: DownloadTask) {
    updateUrl(task.url);
    setSelectedMusic(null);
    setDownloadTasks((current) => current.filter((item) => item.idDownload !== task.idDownload));
    await startDownload(task.type, task.url, task.title);
  }

  async function playLatest() {
    if (!validUrl) return;
    if (playableDownload?.filePath) {
      startQueue([playableDownload], 0, true, "");
      return;
    }
    const existing = await api.findCompleted(url);
    if (!existing?.filePath) {
      setMessage("Baixe o audio ou video antes de reproduzir.");
      return;
    }
    startQueue([existing], 0, true, "");
  }

  function startQueue(nextQueue: DownloadRecord[], index: number, openPlayer = true, artwork?: string) {
    if (!nextQueue.length) return;
    const target = nextQueue[index] || nextQueue[0];
    queueHydratedRef.current = true;
    setQueue(nextQueue);
    setCurrentTrack(target);
    if (artwork !== undefined) setQueueArtwork(artwork);
    setPlaybackMediaUrl(mediaUrlForTrack(target));
    setCurrentTime(0);
    desiredPlaybackRef.current = true;
    setStatus((current) => ({ ...current, play: "playing" }));
    if (openPlayer) {
      setPreviousView(view === "player" ? previousView : view);
      setView("player");
    }
  }

  function handlePlayStateChange(playing: boolean) {
    setIsPlaying(playing);
    setStatus((current) => {
      if (!playing && current.play === "failed") return current;
      return { ...current, play: playing ? "playing" : "idle" };
    });
  }

  function togglePlayback() {
    if (!currentTrack) {
      if (completedDownloads[0]) startQueue(completedDownloads, 0, true, "");
      return;
    }

    const audio = mediaRef.current;
    if (!audio) {
      setIsPlaying((value) => !value);
      return;
    }

    if (audio.paused) {
      desiredPlaybackRef.current = true;
      void audio
        .play()
        .then(() => handlePlayStateChange(true))
        .catch(() => {
          setIsPlaying(false);
          setStatus((current) => ({ ...current, play: "failed" }));
          setMessage("Não foi possível iniciar a reprodução desta mídia.");
        });
    } else {
      desiredPlaybackRef.current = false;
      audio.pause();
      handlePlayStateChange(false);
    }
  }

  function previousTrack() {
    if (!currentTrack) return;
    const audio = mediaRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    const index = queue.findIndex((item) => item.idDownload === currentTrack.idDownload);
    const nextIndex = index <= 0 ? queue.length - 1 : index - 1;
    startQueue(queue, nextIndex, false);
  }

  function nextTrack() {
    if (!currentTrack) return;
    const index = queue.findIndex((item) => item.idDownload === currentTrack.idDownload);
    if (index >= queue.length - 1) {
      if (repeatQueue) {
        if (queue.length > 1) {
          startQueue(queue, 0, false);
          return;
        }
        const media = mediaRef.current;
        if (media) {
          media.currentTime = 0;
          setCurrentTime(0);
          void media.play().catch(() => {
            setIsPlaying(false);
            setMessage("Não foi possível repetir esta mídia.");
          });
        } else {
          startQueue(queue, 0, false);
        }
      }
      else {
        desiredPlaybackRef.current = false;
        mediaRef.current?.pause();
        setIsPlaying(false);
        setStatus((current) => ({ ...current, play: "idle" }));
      }
      return;
    }
    startQueue(queue, index + 1, false);
  }

  function seek(value: number) {
    const audio = mediaRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setCurrentTime(value);
  }

  function moveQueueTrack(index: number, direction: -1 | 1) {
    setQueue((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removeQueueTrack(index: number) {
    setQueue((current) => {
      const removed = current[index];
      const next = current.filter((_, itemIndex) => itemIndex !== index);
      if (removed?.idDownload === currentTrack?.idDownload) {
        const replacement = next[Math.min(index, next.length - 1)] || null;
        setCurrentTrack(replacement);
        setPlaybackMediaUrl(mediaUrlForTrack(replacement));
        if (!replacement) setShowQueue(false);
      }
      return next;
    });
  }

  function toggleFavorite(track = currentTrack) {
    if (!track) return;
    const trackReference = playlistTrackFromDownload(track);
    setPlaylists((current) =>
      current.map((playlist) => {
        if (playlist.id !== LIKED_ID) return playlist;
        const exists = playlistContainsDownload(playlist, track);
        const items = synchronizedPlaylistItems(playlist);
        return {
          ...playlist,
          itemIds: exists
            ? playlist.itemIds.filter((id) => id !== track.idDownload)
            : [...playlist.itemIds.filter((id) => id !== track.idDownload), track.idDownload],
          items: exists
            ? items.filter((item) => item.key !== trackReference.key)
            : [...items.filter((item) => item.key !== trackReference.key), trackReference]
        };
      })
    );
    setMessage("Favoritos atualizados.");
  }

  function createPlaylist(name: string, track?: DownloadRecord | null) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const playlist: UserPlaylist = {
      id: crypto.randomUUID(),
      name: trimmed,
      itemIds: track ? [track.idDownload] : [],
      items: track ? [playlistTrackFromDownload(track)] : [],
      createdAt: new Date().toISOString()
    };
    setPlaylists((current) => [...current, playlist]);
    setPlaylistDraft("");
    setShowNewPlaylist(false);
    setShowAddSheet(false);
    setMessage(track ? "Musica adicionada a playlist." : "Playlist criada.");
  }

  async function updatePlaylistCover(playlistId: string, file: File) {
    try {
      const coverImage = await readPlaylistCover(file);
      setPlaylists((current) => current.map((playlist) => (playlist.id === playlistId ? { ...playlist, coverImage } : playlist)));
      setMessage("Capa da playlist atualizada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao alterar a capa.");
    }
  }

  function addCurrentToPlaylists() {
    if (!currentTrack) return;
    const trackReference = playlistTrackFromDownload(currentTrack);
    setPlaylists((current) =>
      current.map((playlist) => {
        if (!sheetSelection.includes(playlist.id) || playlistContainsDownload(playlist, currentTrack)) return playlist;
        return {
          ...playlist,
          itemIds: [...playlist.itemIds.filter((id) => id !== currentTrack.idDownload), currentTrack.idDownload],
          items: [
            ...synchronizedPlaylistItems(playlist).filter((item) => item.key !== trackReference.key),
            trackReference
          ]
        };
      })
    );
    setShowAddSheet(false);
    setSheetSelection([]);
    setMessage("Musica adicionada a playlist.");
  }

  function synchronizedPlaylistItems(playlist: UserPlaylist) {
    if (playlist.items !== undefined) return playlist.items;
    return playlist.itemIds.flatMap((idDownload) => {
      const download = downloads.find((item) => item.idDownload === idDownload);
      return download ? [playlistTrackFromDownload(download)] : [];
    });
  }

  function openPlaylists() {
    refreshDownloads();
    setView("playlists");
  }

  async function loadSettingsHistory() {
    setSettingsHistoryLoaded(true);
    setSettingsHistoryLoading(true);
    setSettingsHistoryError("");
    try {
      setSettingsHistoryDownloads(await api.listDownloadHistory());
    } catch (error) {
      setSettingsHistoryDownloads([]);
      setSettingsHistoryError(error instanceof Error ? error.message : "Nao foi possivel carregar o historico.");
    } finally {
      setSettingsHistoryLoading(false);
    }
  }

  async function downloadFileToDevice(track: DownloadRecord) {
    if (fileDownloadBusyId !== null) return;
    setFileDownloadBusyId(track.idDownload);
    try {
      const saved = await api.downloadFile(track);
      if (saved) {
        setMessage(window.esporteFai ? "Arquivo salvo no dispositivo." : "Download do arquivo iniciado.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Nao foi possivel baixar o arquivo.");
    } finally {
      setFileDownloadBusyId(null);
    }
  }

  function openSettings() {
    setSettingsHistoryLoaded(false);
    setInstallHelp(null);
    setView("settings");
  }

  async function persistAndLogout() {
    try {
      await flushPendingLibrarySave();
    } catch {
      setMessage("Nao foi possivel salvar as alteracoes da sua conta.");
      throw new Error("A biblioteca ainda nao foi salva.");
    }
    await onLogout();
  }

  async function installApp() {
    if (appInstalled || isRunningAsInstalledApp()) {
      setAppInstalled(true);
      setInstallHelp(null);
      setMessage("O Esporte Fai já está instalado neste dispositivo.");
      return;
    }

    if (!installPrompt) {
      setMessage("");
      setInstallHelp(isIOSDevice() ? "ios" : "browser");
      return;
    }

    setInstallHelp(null);
    setInstallingApp(true);
    setMessage("Autorize a instalação na janela do navegador.");

    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      deferredInstallPrompt = null;
      setInstallPrompt(null);
      if (choice.outcome === "accepted") {
        setAppInstalled(true);
      }
      setMessage(
        choice.outcome === "accepted"
          ? "Autorização confirmada. Concluindo a instalação..."
          : "Instalação cancelada. Você pode tentar novamente pelo menu do navegador."
      );
    } catch {
      setInstallHelp("browser");
      setMessage("");
    } finally {
      setInstallingApp(false);
    }
  }

  async function saveAudioOffline(track: DownloadRecord) {
    try {
      setOfflineBusyId(track.idDownload);
      await saveTrackOffline(track, authUser.idUser);
      upsertOfflineRecord(track, authUser.idUser);
      setOfflineAudioIds((current) => (current.includes(track.idDownload) ? current : [...current, track.idDownload]));
      setMessage("Musica salva offline neste aparelho.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao salvar offline.");
    } finally {
      setOfflineBusyId(null);
    }
  }

  async function removeAudioOffline(track: DownloadRecord) {
    try {
      await removeTrackOffline(track, authUser.idUser);
      setOfflineAudioIds((current) => current.filter((id) => id !== track.idDownload));
      setMessage("Musica removida do offline.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao remover musica offline.");
    }
  }

  async function togglePlaylistOffline() {
    if (offlinePlaylistProgress) {
      if (offlinePlaylistProgress.mode === "removing") return;
      offlinePlaylistAbortRef.current?.abort();
      setMessage("Cancelando operação offline...");
      return;
    }
    if (window.esporteFai) {
      setMessage("O modo offline de playlists esta disponivel no PWA ou navegador.");
      return;
    }
    if (!playlistOfflineTotal) {
      setMessage("Esta playlist nao possui audios disponiveis para uso offline.");
      return;
    }

    if (playlistOfflineComplete) {
      const confirmed = window.confirm(`Remover as ${playlistOfflineSaved} musicas offline desta playlist?`);
      if (!confirmed) return;

      const removedIds: number[] = [];
      let failures = 0;
      setOfflinePlaylistProgress({ mode: "removing", completed: 0, total: selectedAudioTracks.length });
      try {
        for (const track of selectedAudioTracks) {
          setOfflineBusyId(track.idDownload);
          try {
            await removeTrackOffline(track, authUser.idUser);
            removedIds.push(track.idDownload);
          } catch {
            failures += 1;
          } finally {
            setOfflinePlaylistProgress((current) =>
              current ? { ...current, completed: current.completed + 1 } : current
            );
          }
        }
        setOfflineAudioIds((current) => current.filter((id) => !removedIds.includes(id)));
        setMessage(
          failures
            ? `${removedIds.length} musicas removidas do offline; ${failures} nao puderam ser removidas.`
            : "Playlist removida do offline neste aparelho."
        );
      } finally {
        setOfflineBusyId(null);
        setOfflinePlaylistProgress(null);
      }
      return;
    }

    const missingLocalTracks = selectedAudioTracks.filter((track) => !offlineAudioIds.includes(track.idDownload));
    const tracksToPrepare = unavailableSyncedAudioTracks;
    const operationTotal = missingLocalTracks.length + tracksToPrepare.length;
    const totalBytes = missingLocalTracks.reduce((sum, track) => sum + (track.sizeBytes || 0), 0);
    const controller = new AbortController();
    offlinePlaylistAbortRef.current = controller;
    let completedBytes = 0;
    let saved = 0;
    let failures = 0;
    setOfflinePlaylistProgress({ mode: "saving", completed: 0, total: operationTotal, receivedBytes: 0, totalBytes });

    const markCompleted = () => {
      setOfflinePlaylistProgress((current) =>
        current ? { ...current, completed: current.completed + 1 } : current
      );
    };
    const cacheTrack = async (track: DownloadRecord) => {
      setOfflineBusyId(track.idDownload);
      await saveTrackOffline(track, authUser.idUser, {
        signal: controller.signal,
        onProgress: (receivedBytes) => setOfflinePlaylistProgress((current) => current ? { ...current, receivedBytes: completedBytes + receivedBytes } : current)
      });
      upsertOfflineRecord(track, authUser.idUser);
      setOfflineAudioIds((current) =>
        current.includes(track.idDownload) ? current : [...current, track.idDownload]
      );
      saved += 1;
      completedBytes += track.sizeBytes || 0;
    };

    try {
      for (const track of missingLocalTracks) {
        if (controller.signal.aborted) break;
        try {
          await cacheTrack(track);
        } catch {
          failures += 1;
        } finally {
          markCompleted();
        }
      }

      for (const syncedTrack of tracksToPrepare) {
        if (controller.signal.aborted) break;
        setSyncedDownloadBusyKey(syncedTrack.key);
        try {
          let localTrack = await api.findCompleted(syncedTrack.url, syncedTrack.type);
          if (!localTrack?.filePath) {
            const startedDownload = await api.startDownload(syncedTrack.url, syncedTrack.type);
            if (!startedDownload.filePath) {
              await waitForWebDownload(startedDownload.idDownload, syncedTrack.type);
            }
            localTrack = await api.findCompleted(syncedTrack.url, syncedTrack.type);
          }
          if (!localTrack?.filePath) {
            throw new Error("A musica nao ficou disponivel para o modo offline.");
          }
          await cacheTrack(localTrack);
        } catch {
          failures += 1;
        } finally {
          setSyncedDownloadBusyKey(null);
          markCompleted();
        }
      }

      if (tracksToPrepare.length) await refreshDownloads();
      setMessage(
        controller.signal.aborted
          ? `Operação cancelada. ${saved} músicas foram mantidas offline.`
          : failures
          ? `${saved} musicas salvas offline; ${failures} nao puderam ser baixadas.`
          : "Playlist disponivel offline neste aparelho."
      );
    } finally {
      setOfflineBusyId(null);
      setSyncedDownloadBusyKey(null);
      setOfflinePlaylistProgress(null);
      offlinePlaylistAbortRef.current = null;
    }
  }

  function currentMediaUrl() {
    if (currentTrack && playbackMediaUrl) {
      return playbackMediaUrl;
    }
    return mediaUrlForTrack(currentTrack);
  }

  function mediaUrlForTrack(track?: DownloadRecord | null) {
    if (track?.type === "audio" && offlineAudioIds.includes(track.idDownload)) {
      return offlineUrl(track, authUser.idUser);
    }
    return streamUrl(track);
  }

  function handleMediaError() {
    const track = currentTrack;
    if (!track) return;

    if (track.type !== "audio" || !playbackMediaUrl.startsWith("/offline-media/")) {
      setIsPlaying(false);
      desiredPlaybackRef.current = false;
      setStatus((current) => ({ ...current, play: "failed" }));
      setMessage("Não foi possível carregar o arquivo. Atualize a biblioteca e tente novamente.");
      return;
    }

    removeTrackOffline(track, authUser.idUser).catch(() => undefined);
    setOfflineAudioIds((current) => current.filter((id) => id !== track.idDownload));
    setPlaybackMediaUrl(streamUrl(track));
    setMessage("Arquivo offline nao esta mais no aparelho. Tentando reproduzir pela internet.");

    window.setTimeout(() => {
      const media = mediaRef.current;
      if (!media) return;
      media.load();
      media
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {
          setIsPlaying(false);
          setMessage("Arquivo offline nao esta mais no aparelho e a musica nao abriu pela internet.");
        });
    }, 0);
  }

  if (!libraryLoaded) {
    return (
      <main className="auth-shell auth-loading" aria-busy={!libraryLoadError}>
        <span>{libraryLoadError || "Carregando sua biblioteca..."}</span>
        {libraryLoadError && (
          <button
            className="auth-submit pressable"
            type="button"
            onClick={() => {
              libraryLoadPromiseRef.current = null;
              setLibraryLoadAttempt((current) => current + 1);
            }}
          >
            Tentar novamente
          </button>
        )}
      </main>
    );
  }

  return (
    <main className={`app-shell ${view === "main" ? "home-screen" : ""}`}>
      {view !== "main" && message && (
        <div className="global-message" role="status">
          {message}
        </div>
      )}
      {currentTrack?.type !== "video" && (
        <audio
          ref={mediaRef as React.MutableRefObject<HTMLAudioElement | null>}
          src={currentMediaUrl()}
          preload="auto"
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
          onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
          onSeeking={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onSeeked={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onPlay={() => {
            desiredPlaybackRef.current = true;
            handlePlayStateChange(true);
          }}
          onPause={() => handlePlayStateChange(false)}
          onError={handleMediaError}
          onEnded={nextTrack}
        />
      )}

      {currentTrack && view !== "player" && (
        <PlayerReturnTab
          track={currentTrack}
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          artwork={queueArtwork}
          togglePlayback={togglePlayback}
          openPlayer={() => {
            setPreviousView(view);
            setView("player");
          }}
        />
      )}

      {view === "main" && (
        <HomeView
          username={authUser.username}
          recentTracks={recentTracks}
          playlists={playlists}
          playTrack={(track) => startQueue([track], 0, true, "")}
          openPlaylist={(id) => {
            setSelectedPlaylistId(id);
            setView("playlist-detail");
          }}
          openSettings={openSettings}
        />
      )}

      {view === "search" && (
        <SearchView
          url={url}
          setUrl={updateUrl}
          validUrl={validUrl}
          musicSearch={musicSearch}
          setMusicSearch={updateSmartSearch}
          musicResults={musicResults}
          musicSearchLoading={musicSearchLoading}
          musicSearchError={musicSearchError}
          recentSearches={recentSearches}
          selectedMusic={selectedMusic}
          runMusicSearch={searchMusicByName}
          selectMusic={selectMusic}
          playResult={playSearchResult}
          canPlayLatest={Boolean(playableDownload)}
          audioSize={audioSize}
          videoSize={videoSize}
          status={status}
          progress={progress}
          message={message}
          downloadTasks={downloadTasks}
          cancelDownload={cancelDownloadTask}
          retryDownload={retryDownloadTask}
          startDownload={startDownload}
          playLatest={playLatest}
          cancelSearch={() => {
            setMusicSearch("");
            setMusicResults([]);
            setMusicSearchError("");
            setSelectedMusic(null);
          }}
          removeRecentSearch={(videoId) => setRecentSearches((current) => current.filter((item) => item.videoId !== videoId))}
        />
      )}

      {view === "playlists" && (
        <PlaylistsView
          playlists={playlists}
          downloads={completedDownloads}
          username={authUser.username}
          openPlaylist={(id) => {
            setSelectedPlaylistId(id);
            setView("playlist-detail");
          }}
          createPlaylist={() => {
            setNewPlaylistTrack(null);
            setShowNewPlaylist(true);
          }}
          updatePlaylistCover={updatePlaylistCover}
        />
      )}

      {view === "playlist-detail" && (
        <PlaylistDetailView
          playlist={selectedPlaylist}
          tracks={filteredTracks}
          syncedTracks={filteredSyncedTracks}
          totalTracks={selectedTracks.length + unavailableSyncedTracks.length}
          playableTracks={selectedTracks.length}
          search={search}
          setSearch={setSearch}
          back={() => setView("playlists")}
          playAll={() => startQueue(selectedTracks, 0, true, selectedPlaylist.coverImage || "")}
          shuffle={() => startQueue([...selectedTracks].sort(() => Math.random() - 0.5), 0, true, selectedPlaylist.coverImage || "")}
          playTrack={(track) => startQueue(selectedTracks, selectedTracks.findIndex((item) => item.idDownload === track.idDownload), true, selectedPlaylist.coverImage || "")}
          currentTrack={currentTrack}
          offlineAudioIds={offlineAudioIds}
          offlineBusyId={offlineBusyId}
          offlinePlaylistBusy={Boolean(offlinePlaylistProgress)}
          offlinePlaylistComplete={playlistOfflineComplete}
          offlinePlaylistProgress={offlinePlaylistProgress}
          offlinePlaylistTotal={playlistOfflineTotal}
          offlineSupported={!window.esporteFai}
          togglePlaylistOffline={togglePlaylistOffline}
          saveAudioOffline={saveAudioOffline}
          removeAudioOffline={removeAudioOffline}
          syncedDownloadBusyKey={syncedDownloadBusyKey}
          downloadSyncedTrack={downloadSyncedTrack}
          updatePlaylistCover={updatePlaylistCover}
        />
      )}

      {currentTrack && (
        <div className={view === "player" ? "persistent-player visible" : "persistent-player background"} aria-hidden={view !== "player"}>
          <PlayerView
          track={currentTrack}
          artwork={queueArtwork}
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          isFavorite={Boolean(isFavorite)}
          repeatQueue={repeatQueue}
          back={() => setView(previousView)}
          togglePlayback={togglePlayback}
          previousTrack={previousTrack}
          nextTrack={nextTrack}
          seek={seek}
          toggleFavorite={() => toggleFavorite()}
          openAddSheet={() => {
            setSheetSelection([]);
            setShowAddSheet(true);
          }}
          openQueue={() => setShowQueue(true)}
          toggleRepeat={() => setRepeatQueue((value) => !value)}
          isOfflineSaved={currentTrack ? offlineAudioIds.includes(currentTrack.idDownload) : false}
          offlineBusy={currentTrack ? offlineBusyId === currentTrack.idDownload : false}
          saveOffline={() => currentTrack && saveAudioOffline(currentTrack)}
          removeOffline={() => currentTrack && removeAudioOffline(currentTrack)}
          downloadFile={() => currentTrack && downloadFileToDevice(currentTrack)}
          fileDownloadBusy={currentTrack ? fileDownloadBusyId === currentTrack.idDownload : false}
          mediaRef={mediaRef}
          mediaUrl={currentMediaUrl()}
          onTimeUpdate={(time) => setCurrentTime(time)}
          onDurationChange={(nextDuration) => setDuration(nextDuration)}
          onPlayStateChange={handlePlayStateChange}
          onMediaError={handleMediaError}
          onEnded={nextTrack}
          />
        </div>
      )}

      {view === "settings" && (
        <SettingsView
          idUser={authUser.idUser}
          username={authUser.username}
          downloads={settingsHistoryDownloads}
          historyLoaded={settingsHistoryLoaded}
          historyLoading={settingsHistoryLoading}
          historyError={settingsHistoryError}
          fullHistory={authUser.username.normalize("NFKC").trim().toLocaleLowerCase("pt-BR") === "tocagando1234"}
          allBlack={allBlack}
          installState={
            appInstalled ? "installed" : installingApp ? "installing" : installPrompt ? "available" : isIOSDevice() ? "ios" : "manual"
          }
          installHelp={installHelp}
          openMain={() => setView("main")}
          installApp={installApp}
          closeInstallHelp={() => setInstallHelp(null)}
          loadHistory={loadSettingsHistory}
          closeHistory={() => {
            setSettingsHistoryLoaded(false);
            setSettingsHistoryError("");
          }}
          toggleAllBlack={() => setAllBlack((value) => !value)}
          playTrack={(track) => startQueue([track], 0, true, "")}
          downloadFile={downloadFileToDevice}
          fileDownloadBusyId={fileDownloadBusyId}
          logout={persistAndLogout}
        />
      )}

      {showAddSheet && currentTrack && (
        <BottomSheet
          playlists={playlists.filter((playlist) => !playlist.special)}
          selection={sheetSelection}
          setSelection={setSheetSelection}
          close={() => setShowAddSheet(false)}
          confirm={addCurrentToPlaylists}
          createNew={() => {
            setNewPlaylistTrack(currentTrack);
            setShowAddSheet(false);
            setShowNewPlaylist(true);
          }}
        />
      )}

      {showQueue && (
        <QueueSheet
          queue={queue}
          currentTrackId={currentTrack?.idDownload}
          close={() => setShowQueue(false)}
          play={(index) => startQueue(queue, index, false)}
          move={moveQueueTrack}
          remove={removeQueueTrack}
          clear={() => {
            mediaRef.current?.pause();
            setQueue([]);
            setCurrentTrack(null);
            setPlaybackMediaUrl("");
            setShowQueue(false);
          }}
        />
      )}

      {showNewPlaylist && (
        <Modal
          title="Nova Playlist"
          value={playlistDraft}
          setValue={setPlaylistDraft}
          close={() => setShowNewPlaylist(false)}
          confirm={() => createPlaylist(playlistDraft, newPlaylistTrack)}
        />
      )}

      {view !== "player" && view !== "settings" && (
        <BottomNavigation
          activeView={view === "search" ? "search" : view === "main" ? "main" : "playlists"}
          navigate={(destination) => {
            setView(destination);
            if (destination !== "playlists") setSearch("");
          }}
        />
      )}
    </main>
  );
}

function App() {
  const [authState, setAuthState] = useState<"loading" | "guest" | "authenticated">("loading");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    registerServiceWorker();
  }, []);

  useEffect(() => {
    const handleExpiredSession = () => {
      setAuthUser(null);
      setAuthState("guest");
    };
    window.addEventListener("auth-session-expired", handleExpiredSession);
    return () => window.removeEventListener("auth-session-expired", handleExpiredSession);
  }, []);

  useEffect(() => {
    let active = true;
    api
      .authSession()
      .then(({ user }) => {
        if (!active) return;
        if (user) cacheAuthenticatedUser(user);
        setAuthUser(user);
        setAuthState(user ? "authenticated" : "guest");
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          setAuthUser(null);
          setAuthState("guest");
          return;
        }
        const cachedUser = readCachedUser();
        if (cachedUser) {
          setAuthUser(cachedUser);
          setAuthState("authenticated");
        } else {
          setAuthUser(null);
          setAuthState("guest");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (authState === "loading") {
    return (
      <main className="auth-shell auth-loading" aria-busy="true">
        <span>Carregando...</span>
      </main>
    );
  }

  if (authState === "guest" || !authUser) {
    return (
      <AuthView
        onAuthenticated={(user) => {
          cacheAuthenticatedUser(user);
          setAuthUser(user);
          setAuthState("authenticated");
        }}
      />
    );
  }

  return (
    <AuthenticatedApp
      authUser={authUser}
      onLogout={async () => {
        await api.authLogout();
        localStorage.removeItem(CACHED_USER_KEY);
        setAuthUser(null);
        setAuthState("guest");
      }}
    />
  );
}

function librariesEqual(left: UserPlaylist[], right: UserPlaylist[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function upsertDownloadTask(tasks: DownloadTask[], task: DownloadTask) {
  return [task, ...tasks.filter((item) => item.idDownload !== task.idDownload)].slice(0, 12);
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
