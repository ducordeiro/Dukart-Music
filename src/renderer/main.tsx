import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  AuthUser,
  DownloadRecord,
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
import { api } from "./api";
import { AuthView } from "./AuthView";
import { BottomSheet, HomeView, Modal, PlayerReturnTab, PlayerView, PlaylistDetailView, PlaylistsView, SettingsView } from "./components";
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

function lockApplicationScale() {
  const zoomCodes = new Set(["Equal", "Minus", "Digit0", "NumpadAdd", "NumpadSubtract", "Numpad0"]);

  const preventKeyboardZoom = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && zoomCodes.has(event.code)) {
      event.preventDefault();
    }
  };
  const preventWheelZoom = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
    }
  };
  const preventGestureZoom = (event: Event) => {
    event.preventDefault();
  };

  window.addEventListener("keydown", preventKeyboardZoom, { capture: true });
  window.addEventListener("wheel", preventWheelZoom, { capture: true, passive: false });
  document.addEventListener("gesturestart", preventGestureZoom, { capture: true, passive: false });
  document.addEventListener("gesturechange", preventGestureZoom, { capture: true, passive: false });
  document.addEventListener("gestureend", preventGestureZoom, { capture: true, passive: false });

  return () => {
    window.removeEventListener("keydown", preventKeyboardZoom, { capture: true });
    window.removeEventListener("wheel", preventWheelZoom, { capture: true });
    document.removeEventListener("gesturestart", preventGestureZoom, { capture: true });
    document.removeEventListener("gesturechange", preventGestureZoom, { capture: true });
    document.removeEventListener("gestureend", preventGestureZoom, { capture: true });
  };
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
  const [playlists, setPlaylists] = useState<UserPlaylist[]>(() => [likedPlaylist()]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryLoadError, setLibraryLoadError] = useState("");
  const [libraryLoadAttempt, setLibraryLoadAttempt] = useState(0);
  const libraryLoadPromiseRef = useRef<Promise<UserLibrarySnapshot> | null>(null);
  const librarySaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const playlistsRef = useRef(playlists);
  const libraryBaseRef = useRef<UserPlaylist[]>(playlists);
  const libraryRevisionRef = useRef(0);
  const skipNextLibrarySaveRef = useRef(false);
  const [queue, setQueue] = useState<DownloadRecord[]>([]);
  const [currentTrack, setCurrentTrack] = useState<DownloadRecord | null>(null);
  const [playbackMediaUrl, setPlaybackMediaUrl] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);
  const [newPlaylistTrack, setNewPlaylistTrack] = useState<DownloadRecord | null>(null);
  const [playlistDraft, setPlaylistDraft] = useState("");
  const [sheetSelection, setSheetSelection] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [repeatQueue, setRepeatQueue] = useState(false);
  const [settingsHistoryLoaded, setSettingsHistoryLoaded] = useState(false);
  const [allBlack, setAllBlack] = useState(() => localStorage.getItem(THEME_KEY) === "true");
  const [offlineAudioIds, setOfflineAudioIds] = useState<number[]>(() => readOfflineAudioIds(authUser.idUser));
  const [offlineBusyId, setOfflineBusyId] = useState<number | null>(null);
  const [syncedDownloadBusyKey, setSyncedDownloadBusyKey] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(() => deferredInstallPrompt);
  const [appInstalled, setAppInstalled] = useState(() => installedFromBrowserEvent || isRunningAsInstalledApp());
  const [installingApp, setInstallingApp] = useState(false);
  const [installHelp, setInstallHelp] = useState<"ios" | "browser" | null>(null);

  const validUrl = useMemo(() => isValidUrl(url), [url]);
  const completedDownloads = useMemo(() => downloads.filter((item) => item.status === "completed" && item.filePath), [downloads]);
  const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId) || playlists[0] || likedPlaylist();
  const selectedTracks = completedDownloads.filter((item) => playlistContainsDownload(selectedPlaylist, item));
  const selectedTrackKeys = new Set(selectedTracks.map((track) => playlistTrackKey(track.url, track.type)));
  const unavailableSyncedTracks = (selectedPlaylist.items || []).filter((item) => !selectedTrackKeys.has(item.key));
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
    let active = true;
    setLibraryLoaded(false);
    setLibraryLoadError("");

    if (!libraryLoadPromiseRef.current) {
      libraryLoadPromiseRef.current = (async () => {
        const storedLibrary = await api.loadLibrary();
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
  }, [libraryLoaded, playlists]);

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
        await librarySaveChainRef.current;
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
    if (!mediaRef.current || !currentTrack || window.esporteFai) return;
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

  useEffect(() => {
    let frame = 0;

    const syncTimeline = () => {
      const audio = mediaRef.current;
      if (audio) {
        setCurrentTime(audio.currentTime || 0);
        if (Number.isFinite(audio.duration)) {
          setDuration(audio.duration || 0);
        }
      }
      if (audio && !audio.paused && !audio.ended) {
        frame = window.requestAnimationFrame(syncTimeline);
      }
    };

    if (isPlaying && !window.esporteFai) {
      frame = window.requestAnimationFrame(syncTimeline);
    }

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [isPlaying, currentTrack]);

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
    setUrl(youtubeUrl(result.videoId));
    setMusicSearchError("");
    setMessage(`Selecionado: ${result.titulo}`);
  }

  function updateUrl(value: string) {
    setSelectedMusic(null);
    setUrl(value);
  }

  async function startDownload(type: DownloadType) {
    if (!validUrl) return;

    try {
      const existing = await api.findCompleted(url, type);
      if (existing?.filePath) {
        const openExisting = window.confirm("Este link ja foi baixado. Reproduzir o arquivo existente?");
        if (openExisting) {
          startQueue([existing], 0);
          return;
        }
      }

      setStatus((current) => ({ ...current, [type]: "loading" }));
      setProgress((current) => ({ ...current, [type]: 0 }));
      setMessage(type === "audio" ? "Baixando audio..." : "Baixando audio e video...");
      const startedDownload = await api.startDownload(url, type);
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
        if (typedError.status === 401 || typedError.terminal || transientFailures >= 5) {
          throw error;
        }
      }

      await new Promise((resolve) => window.setTimeout(resolve, 700));
    }

    throw new Error("O download demorou mais que o esperado. Consulte o histórico em alguns minutos.");
  }

  async function playLatest() {
    if (!validUrl) return;
    if (playableDownload?.filePath) {
      startQueue([playableDownload], 0);
      return;
    }
    const existing = await api.findCompleted(url);
    if (!existing?.filePath) {
      setMessage("Baixe o audio ou video antes de reproduzir.");
      return;
    }
    startQueue([existing], 0);
  }

  function startQueue(nextQueue: DownloadRecord[], index: number, openPlayer = true) {
    if (!nextQueue.length) return;
    const target = nextQueue[index] || nextQueue[0];
    setQueue(nextQueue);
    setCurrentTrack(target);
    setPlaybackMediaUrl(mediaUrlForTrack(target));
    setCurrentTime(0);
    desiredPlaybackRef.current = true;
    setStatus((current) => ({ ...current, play: "playing" }));
    if (openPlayer) {
      setPreviousView(view === "player" ? previousView : view);
      setView("player");
    }
    if (window.esporteFai) {
      api.playExternal(target);
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
      if (completedDownloads[0]) startQueue(completedDownloads, 0);
      return;
    }

    const audio = mediaRef.current;
    if (!audio || window.esporteFai) {
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
    await refreshDownloads();
    setSettingsHistoryLoaded(true);
  }

  function openSettings() {
    setSettingsHistoryLoaded(false);
    setInstallHelp(null);
    setView("settings");
  }

  async function persistAndLogout() {
    try {
      await librarySaveChainRef.current;
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
      if (!media || window.esporteFai) return;
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
      <header className="app-header">
        <img className="app-logo" src="./esporte-fai-logo.png" alt="ESPORTE FAI" />
      </header>
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
          openPlayer={() => {
            setPreviousView(view);
            setView("player");
          }}
        />
      )}

      {view === "main" && (
        <HomeView
          url={url}
          setUrl={updateUrl}
          validUrl={validUrl}
          musicSearch={musicSearch}
          setMusicSearch={setMusicSearch}
          musicResults={musicResults}
          musicSearchLoading={musicSearchLoading}
          musicSearchError={musicSearchError}
          selectedMusic={selectedMusic}
          runMusicSearch={searchMusicByName}
          selectMusic={selectMusic}
          canPlayLatest={Boolean(playableDownload)}
          audioSize={audioSize}
          videoSize={videoSize}
          status={status}
          progress={progress}
          message={message}
          startDownload={startDownload}
          playLatest={playLatest}
          openPlaylists={openPlaylists}
          openSettings={openSettings}
        />
      )}

      {view === "playlists" && (
        <PlaylistsView
          playlists={playlists}
          downloads={completedDownloads}
          openMain={() => setView("main")}
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
          playAll={() => startQueue(selectedTracks, 0)}
          shuffle={() => startQueue([...selectedTracks].sort(() => Math.random() - 0.5), 0)}
          playTrack={(track) => startQueue(selectedTracks, selectedTracks.findIndex((item) => item.idDownload === track.idDownload))}
          currentTrack={currentTrack}
          offlineAudioIds={offlineAudioIds}
          offlineBusyId={offlineBusyId}
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
          toggleRepeat={() => setRepeatQueue((value) => !value)}
          isOfflineSaved={currentTrack ? offlineAudioIds.includes(currentTrack.idDownload) : false}
          offlineBusy={currentTrack ? offlineBusyId === currentTrack.idDownload : false}
          saveOffline={() => currentTrack && saveAudioOffline(currentTrack)}
          removeOffline={() => currentTrack && removeAudioOffline(currentTrack)}
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
          username={authUser.username}
          downloads={downloads}
          historyLoaded={settingsHistoryLoaded}
          allBlack={allBlack}
          installState={
            appInstalled ? "installed" : installingApp ? "installing" : installPrompt ? "available" : isIOSDevice() ? "ios" : "manual"
          }
          installHelp={installHelp}
          openMain={() => setView("main")}
          installApp={installApp}
          closeInstallHelp={() => setInstallHelp(null)}
          loadHistory={loadSettingsHistory}
          closeHistory={() => setSettingsHistoryLoaded(false)}
          toggleAllBlack={() => setAllBlack((value) => !value)}
          playTrack={(track) => startQueue([track], 0)}
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

      {showNewPlaylist && (
        <Modal
          title="Nova Playlist"
          value={playlistDraft}
          setValue={setPlaylistDraft}
          close={() => setShowNewPlaylist(false)}
          confirm={() => createPlaylist(playlistDraft, newPlaylistTrack)}
        />
      )}
    </main>
  );
}

function App() {
  const [authState, setAuthState] = useState<"loading" | "guest" | "authenticated">("loading");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);

  useEffect(() => lockApplicationScale(), []);

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
        setAuthUser(user);
        setAuthState(user ? "authenticated" : "guest");
      })
      .catch(() => {
        if (!active) return;
        setAuthUser(null);
        setAuthState("guest");
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
        setAuthUser(null);
        setAuthState("guest");
      }}
    />
  );
}

function librariesEqual(left: UserPlaylist[], right: UserPlaylist[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
