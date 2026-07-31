import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  Download,
  FolderPlus,
  Headphones,
  Heart,
  History,
  ListMusic,
  Loader2,
  MoreVertical,
  Moon,
  Pause,
  Play,
  Plus,
  Repeat2,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  Video,
  X
} from "lucide-react";
import type { DownloadRecord, DownloadType, UserPlaylistTrack, YoutubeSearchResult } from "../shared/types";
import type { Status, UserPlaylist } from "./types";
import { formatDateTime, formatMb, formatTime } from "./utils";

function HomeView({
  url,
  setUrl,
  validUrl,
  musicSearch,
  setMusicSearch,
  musicResults,
  musicSearchLoading,
  musicSearchError,
  selectedMusic,
  runMusicSearch,
  selectMusic,
  canPlayLatest,
  audioSize,
  videoSize,
  status,
  progress,
  message,
  startDownload,
  playLatest,
  openPlaylists,
  openSettings
}: {
  url: string;
  setUrl: (value: string) => void;
  validUrl: boolean;
  musicSearch: string;
  setMusicSearch: (value: string) => void;
  musicResults: YoutubeSearchResult[];
  musicSearchLoading: boolean;
  musicSearchError: string;
  selectedMusic: YoutubeSearchResult | null;
  runMusicSearch: () => void;
  selectMusic: (result: YoutubeSearchResult) => void;
  canPlayLatest: boolean;
  audioSize: number | null;
  videoSize: number | null;
  status: Record<DownloadType | "play", Status>;
  progress: Record<DownloadType, number>;
  message: string;
  startDownload: (type: DownloadType) => void;
  playLatest: () => void;
  openPlaylists: () => void;
  openSettings: () => void;
}) {
  const [resultsCollapsed, setResultsCollapsed] = useState(false);

  useEffect(() => {
    if (musicResults.length > 0) {
      setResultsCollapsed(false);
    }
  }, [musicResults]);

  return (
    <section className="main-panel" aria-label="Download panel">
      <div className="music-search-panel">
        <label className="music-search-label" htmlFor="music-search-input">
          Buscar ou inserir o link (youtube)
        </label>
        <div className="music-search-row">
          <div className="music-search-box">
            <Search size={18} />
            <input
              id="music-search-input"
              type="text"
              value={musicSearch}
              onChange={(event) => setMusicSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  runMusicSearch();
                }
              }}
              placeholder="Digite o nome da musica"
              disabled={musicSearchLoading}
            />
          </div>
          <button className="music-search-submit pressable" type="button" onClick={runMusicSearch} disabled={musicSearchLoading}>
            {musicSearchLoading ? (
              <Loader2 className="spin" size={18} />
            ) : (
              <>
                <CornerDownLeft size={17} />
                <span>Enter</span>
              </>
            )}
          </button>
        </div>

        {(musicSearchLoading || musicSearchError) && (
          <p className={`search-feedback ${musicSearchError ? "error" : ""}`}>
            {musicSearchLoading ? "Buscando..." : musicSearchError}
          </p>
        )}

        {musicResults.length > 0 && (
          <div className="music-results-toolbar">
            <button
              className="small-toggle-button pressable"
              type="button"
              onClick={() => setResultsCollapsed((value) => !value)}
              aria-expanded={!resultsCollapsed}
              title={resultsCollapsed ? "Descer resultados" : "Subir resultados"}
            >
              {resultsCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              <span>{resultsCollapsed ? "Descer" : "Subir"}</span>
            </button>
          </div>
        )}

        {musicResults.length > 0 && !resultsCollapsed && (
          <div className="music-result-list">
            {musicResults.map((result) => {
              const selected = selectedMusic?.videoId === result.videoId;
              return (
                <article className={`music-result-card ${selected ? "selected" : ""}`} key={result.videoId}>
                  {result.thumbnail ? (
                    <img src={result.thumbnail} alt="" />
                  ) : (
                    <div className="music-result-fallback">
                      <Headphones size={22} />
                    </div>
                  )}
                  <div className="music-result-copy">
                    <strong title={result.titulo}>{result.titulo}</strong>
                    <span>{result.canal}</span>
                  </div>
                  <button className="select-result-button pressable" type="button" onClick={() => selectMusic(result)}>
                    {selected ? <Check size={17} /> : "Selecionar"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="input-group">
        <label className="sr-only" htmlFor="url-input">
          URL
        </label>
        <input
          id="url-input"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="URL: www.test/123/abc...."
          aria-invalid={url.length > 0 && !validUrl}
        />
      </div>
      <p className={`validation ${url && !validUrl ? "visible" : ""}`}>Enter a valid URL.</p>

      <div className="actions">
        <ActionRow
          label="Audio"
          text={`${formatMb(audioSize)} Only audio`}
          icon={<Headphones size={24} />}
          enabled={validUrl}
          accent="orange"
          status={status.audio}
          progress={progress.audio}
          onClick={() => startDownload("audio")}
        />
        <ActionRow
          label="A+V"
          text={`${formatMb(videoSize)} With video`}
          icon={<Video size={24} />}
          enabled={validUrl}
          accent="red"
          status={status.video}
          progress={progress.video}
          onClick={() => startDownload("video")}
        />
        <ActionRow
          label="Play"
          buttonText={status.play === "playing" ? "PLAYING" : "PLAY SONG"}
          text={status.play === "playing" ? "PLAYING" : "PLAY SONG"}
          icon={<Play size={25} fill="currentColor" />}
          enabled={canPlayLatest}
          accent="green"
          layout="centered"
          status={status.play}
          onClick={playLatest}
        />
      </div>

      <button className="playlist-button pressable" onClick={openPlaylists}>
        <ListMusic size={24} />
        PLAYLIST
      </button>

      <button className="settings-button pressable" onClick={openSettings}>
        <Settings size={21} />
        CONFIGURACOES
      </button>

      <div className="message" role="status">
        {message}
      </div>
    </section>
  );
}

function ActionRow({
  label,
  buttonText,
  text,
  icon,
  enabled,
  accent,
  layout = "row",
  status,
  progress,
  onClick
}: {
  label: string;
  buttonText?: string;
  text: string;
  icon: React.ReactNode;
  enabled: boolean;
  accent: "orange" | "red" | "green";
  layout?: "row" | "centered";
  status: Status;
  progress?: number;
  onClick: () => void;
}) {
  const busy = status === "loading";
  const centered = layout === "centered";
  return (
    <div className={`action-row ${centered ? "centered" : ""} ${enabled ? "enabled" : "disabled"} ${accent}`}>
      <button className="round-button pressable" type="button" disabled={!enabled || busy} onClick={onClick} title={label}>
        {busy ? <Loader2 className="spin" size={24} /> : icon}
        <span>{buttonText || label}</span>
      </button>
      {!centered && (
        <div className="info-pill">
          <span>{busy && typeof progress === "number" ? `${Math.round(progress)}% ` : ""}</span>
          {text}
        </div>
      )}
    </div>
  );
}

function PlaylistCoverContent({ playlist, iconSize }: { playlist: UserPlaylist; iconSize: number }) {
  if (playlist.coverImage) {
    return <img src={playlist.coverImage} alt="" />;
  }

  return playlist.special ? <Heart fill="currentColor" size={iconSize} /> : <ListMusic size={iconSize} />;
}

function PlaylistCoverButton({
  playlist,
  onCoverSelected,
  className = "playlist-options-button pressable",
  iconSize = 18
}: {
  playlist: UserPlaylist;
  onCoverSelected: (playlistId: string, file: File) => void;
  className?: string;
  iconSize?: number;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <button
        className={className}
        type="button"
        title="Alterar capa da playlist"
        onClick={(event) => {
          event.stopPropagation();
          inputRef.current?.click();
        }}
      >
        <MoreVertical size={iconSize} />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          event.stopPropagation();
          const file = event.currentTarget.files?.[0];
          if (file) {
            onCoverSelected(playlist.id, file);
          }
          event.currentTarget.value = "";
        }}
      />
    </>
  );
}

function PlaylistsView({
  playlists,
  downloads,
  openMain,
  openPlaylist,
  createPlaylist,
  updatePlaylistCover
}: {
  playlists: UserPlaylist[];
  downloads: DownloadRecord[];
  openMain: () => void;
  openPlaylist: (id: string) => void;
  createPlaylist: () => void;
  updatePlaylistCover: (playlistId: string, file: File) => void;
}) {
  return (
    <section className="library-view">
      <div className="screen-topbar">
        <button className="icon-button pressable" onClick={openMain} title="Voltar">
          <ArrowLeft size={22} />
        </button>
        <h2>Playlists</h2>
        <button className="icon-button pressable" onClick={createPlaylist} title="Nova playlist">
          <Plus size={22} />
        </button>
      </div>
      <div className="playlist-grid">
        {playlists.map((playlist) => {
          const items = downloads.filter((item) => playlist.itemIds.includes(item.idDownload));
          const audioCount =
            playlist.items?.filter((item) => item.type === "audio").length ??
            items.filter((item) => item.type === "audio").length;
          const videoCount =
            playlist.items?.filter((item) => item.type === "video").length ??
            items.filter((item) => item.type === "video").length;
          return (
            <div
              className="playlist-card pressable"
              key={playlist.id}
              onClick={() => openPlaylist(playlist.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openPlaylist(playlist.id);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className={`playlist-cover ${playlist.special ? "liked" : ""}`}>
                <PlaylistCoverContent playlist={playlist} iconSize={28} />
              </div>
              <div>
                <strong>{playlist.name}</strong>
                <span>
                  {audioCount} musicas - {videoCount} videos
                </span>
              </div>
              <PlaylistCoverButton playlist={playlist} onCoverSelected={updatePlaylistCover} />
            </div>
          );
        })}
      </div>
      <button className="fab pressable" onClick={createPlaylist} title="Nova playlist">
        <Plus size={28} />
      </button>
    </section>
  );
}

function PlaylistDetailView({
  playlist,
  tracks,
  syncedTracks,
  totalTracks,
  playableTracks,
  search,
  setSearch,
  back,
  playAll,
  shuffle,
  playTrack,
  currentTrack,
  offlineAudioIds,
  offlineBusyId,
  saveAudioOffline,
  removeAudioOffline,
  syncedDownloadBusyKey,
  downloadSyncedTrack,
  updatePlaylistCover
}: {
  playlist: UserPlaylist;
  tracks: DownloadRecord[];
  syncedTracks: UserPlaylistTrack[];
  totalTracks: number;
  playableTracks: number;
  search: string;
  setSearch: (value: string) => void;
  back: () => void;
  playAll: () => void;
  shuffle: () => void;
  playTrack: (track: DownloadRecord) => void;
  currentTrack: DownloadRecord | null;
  offlineAudioIds: number[];
  offlineBusyId: number | null;
  saveAudioOffline: (track: DownloadRecord) => void;
  removeAudioOffline: (track: DownloadRecord) => void;
  syncedDownloadBusyKey: string | null;
  downloadSyncedTrack: (track: UserPlaylistTrack) => void;
  updatePlaylistCover: (playlistId: string, file: File) => void;
}) {
  return (
    <section className="playlist-detail">
      <div className="screen-topbar">
        <button className="icon-button pressable" onClick={back} title="Voltar">
          <ArrowLeft size={22} />
        </button>
        <h2>{playlist.name}</h2>
        <PlaylistCoverButton playlist={playlist} onCoverSelected={updatePlaylistCover} className="icon-button pressable" iconSize={22} />
      </div>
      <div className="playlist-hero">
        <div className={`playlist-cover large ${playlist.special ? "liked" : ""}`}>
          <PlaylistCoverContent playlist={playlist} iconSize={42} />
        </div>
        <div>
          <strong>{playlist.name}</strong>
          <span>{totalTracks} musicas</span>
        </div>
        <div className="hero-actions">
          <button className="shuffle-button pressable" onClick={shuffle} disabled={!playableTracks} title="Embaralhar playlist">
            <Shuffle size={20} />
          </button>
          <button className="play-all-button pressable" onClick={playAll} disabled={!playableTracks} title="Reproduzir playlist">
            <Play fill="currentColor" size={26} />
          </button>
        </div>
      </div>
      <label className="search-box">
        <Search size={18} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar musica..." />
      </label>
      <div className="track-list">
        {tracks.length === 0 && syncedTracks.length === 0 ? (
          <div className="empty-state">
            <strong>Sua playlist esta vazia.</strong>
            <span>Adicione musicas para comecar.</span>
          </div>
        ) : (
          <>
            {tracks.map((track) => {
              const offlineSaved = offlineAudioIds.includes(track.idDownload);
              const offlineBusy = offlineBusyId === track.idDownload;
              return (
                <div className={`track-row pressable ${currentTrack?.idDownload === track.idDownload ? "active" : ""}`} key={track.idDownload} onClick={() => playTrack(track)} role="button" tabIndex={0}>
                  <div className="track-art">{currentTrack?.idDownload === track.idDownload ? <AudioBars /> : <Headphones size={20} />}</div>
                  <div>
                    <strong>{track.title}</strong>
                    <span>{track.channel || track.fileName}</span>
                  </div>
                  {track.type === "audio" ? (
                    <button
                      className={`offline-action pressable ${offlineSaved ? "saved" : ""}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        offlineSaved ? removeAudioOffline(track) : saveAudioOffline(track);
                      }}
                      title={offlineSaved ? "Remover offline" : "Salvar offline"}
                      disabled={offlineBusy}
                    >
                      {offlineBusy ? <Loader2 className="spin" size={17} /> : offlineSaved ? <Check size={17} /> : <Download size={17} />}
                    </button>
                  ) : (
                    <MoreVertical size={18} />
                  )}
                </div>
              );
            })}
            {syncedTracks.map((track) => {
              const busy = syncedDownloadBusyKey === track.key;
              return (
                <div className="track-row" key={track.key}>
                  <div className="track-art"><Download size={20} /></div>
                  <div>
                    <strong>{track.title}</strong>
                    <span>{track.channel || "Sincronizada"} · baixar neste dispositivo</span>
                  </div>
                  <button
                    className="offline-action pressable"
                    onClick={() => downloadSyncedTrack(track)}
                    title="Baixar neste dispositivo"
                    disabled={Boolean(syncedDownloadBusyKey)}
                  >
                    {busy ? <Loader2 className="spin" size={17} /> : <Download size={17} />}
                  </button>
                </div>
              );
            })}
          </>
        )}
      </div>
    </section>
  );
}

function PlayerView({
  track,
  isPlaying,
  currentTime,
  duration,
  isFavorite,
  repeatQueue,
  back,
  togglePlayback,
  previousTrack,
  nextTrack,
  seek,
  toggleFavorite,
  openAddSheet,
  toggleRepeat,
  isOfflineSaved,
  offlineBusy,
  saveOffline,
  removeOffline,
  mediaRef,
  mediaUrl,
  onTimeUpdate,
  onDurationChange,
  onPlayStateChange,
  onMediaError,
  onEnded
}: {
  track: DownloadRecord | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isFavorite: boolean;
  repeatQueue: boolean;
  back: () => void;
  togglePlayback: () => void;
  previousTrack: () => void;
  nextTrack: () => void;
  seek: (value: number) => void;
  toggleFavorite: () => void;
  openAddSheet: () => void;
  toggleRepeat: () => void;
  isOfflineSaved: boolean;
  offlineBusy: boolean;
  saveOffline: () => void;
  removeOffline: () => void;
  mediaRef: React.MutableRefObject<HTMLMediaElement | null>;
  mediaUrl: string;
  onTimeUpdate: (time: number) => void;
  onDurationChange: (duration: number) => void;
  onPlayStateChange: (playing: boolean) => void;
  onMediaError: () => void;
  onEnded: () => void;
}) {
  const mediaEvents = {
    onTimeUpdate: (event: React.SyntheticEvent<HTMLMediaElement>) => onTimeUpdate(event.currentTarget.currentTime),
    onLoadedMetadata: (event: React.SyntheticEvent<HTMLMediaElement>) => onDurationChange(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0),
    onDurationChange: (event: React.SyntheticEvent<HTMLMediaElement>) => onDurationChange(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0),
    onSeeking: (event: React.SyntheticEvent<HTMLMediaElement>) => onTimeUpdate(event.currentTarget.currentTime),
    onSeeked: (event: React.SyntheticEvent<HTMLMediaElement>) => onTimeUpdate(event.currentTarget.currentTime),
    onPlay: () => onPlayStateChange(true),
    onPause: () => onPlayStateChange(false),
    onError: onMediaError,
    onEnded
  };

  return (
    <section className="player-view">
      <div className="player-topbar">
        <button className="icon-button pressable" onClick={back} title="Voltar">
          <ArrowLeft size={24} />
        </button>
        <span>Tocando agora</span>
        <div className="player-tools">
          <button className={`icon-button pressable heart-button ${isFavorite ? "active" : ""}`} onClick={toggleFavorite} title="Favoritar">
            <Heart fill={isFavorite ? "currentColor" : "none"} size={23} />
          </button>
          <button className="icon-button pressable" onClick={openAddSheet} title="Adicionar a playlist">
            <FolderPlus size={23} />
          </button>
          {track?.type === "audio" && (
            <button
              className={`icon-button pressable offline-top ${isOfflineSaved ? "saved" : ""}`}
              onClick={isOfflineSaved ? removeOffline : saveOffline}
              title={isOfflineSaved ? "Remover offline" : "Salvar offline"}
              disabled={offlineBusy}
            >
              {offlineBusy ? <Loader2 className="spin" size={20} /> : isOfflineSaved ? <Check size={21} /> : <Download size={21} />}
            </button>
          )}
        </div>
      </div>

      {track?.type === "video" ? (
        <video
          className="video-art"
          ref={mediaRef as React.MutableRefObject<HTMLVideoElement | null>}
          src={mediaUrl}
          preload="auto"
          playsInline
          {...mediaEvents}
        />
      ) : (
        <>
          <button className="album-art pressable" onDoubleClick={toggleFavorite} title="Toque duplo para favoritar">
            <MusicGlyph />
          </button>
        </>
      )}

      <div className="track-info">
        <div className="marquee">
          <strong>{track?.title || "Nenhuma musica selecionada"}</strong>
        </div>
        <span>{track?.channel || "Escolha uma faixa na playlist"}</span>
      </div>

      <div className="seek-area">
        <div className="seek-times">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
        <input
          className="seek-slider"
          type="range"
          min="0"
          max={duration || 0}
          value={Math.min(currentTime, duration || currentTime)}
          step="0.1"
          disabled={!track}
          onChange={(event) => seek(Number(event.target.value))}
        />
      </div>

      <div className="transport">
        <button className={`icon-button secondary pressable ${repeatQueue ? "active-soft" : ""}`} onClick={toggleRepeat} title="Repetir fila">
          <Repeat2 size={22} />
        </button>
        <button className="icon-button large pressable" onClick={previousTrack} disabled={!track} title="Anterior">
          <SkipBack fill="currentColor" size={28} />
        </button>
        <button className="play-control pressable" onClick={togglePlayback} disabled={!track} title={isPlaying ? "Pause" : "Play"}>
          {isPlaying ? <Pause fill="currentColor" size={32} /> : <Play fill="currentColor" size={32} />}
        </button>
        <button className="icon-button large pressable" onClick={nextTrack} disabled={!track} title="Proxima">
          <SkipForward fill="currentColor" size={28} />
        </button>
        <button className="icon-button secondary pressable" onClick={openAddSheet} disabled={!track} title="Adicionar">
          <Plus size={23} />
        </button>
      </div>
    </section>
  );
}

function PlayerReturnTab({
  track,
  isPlaying,
  openPlayer
}: {
  track: DownloadRecord;
  isPlaying: boolean;
  openPlayer: () => void;
}) {
  return (
    <button className="player-return-tab pressable" type="button" onClick={openPlayer}>
      <span className="player-return-icon">{isPlaying ? <AudioBars /> : <Play fill="currentColor" size={18} />}</span>
      <span>
        <strong>Voltar ao player</strong>
        <small>{track.title}</small>
      </span>
    </button>
  );
}

function SettingsView({
  username,
  downloads,
  historyLoaded,
  allBlack,
  installState,
  installHelp,
  openMain,
  installApp,
  closeInstallHelp,
  loadHistory,
  closeHistory,
  toggleAllBlack,
  playTrack,
  logout
}: {
  username: string;
  downloads: DownloadRecord[];
  historyLoaded: boolean;
  allBlack: boolean;
  installState: "available" | "installing" | "installed" | "ios" | "manual";
  installHelp: "ios" | "browser" | null;
  openMain: () => void;
  installApp: () => void;
  closeInstallHelp: () => void;
  loadHistory: () => Promise<void>;
  closeHistory: () => void;
  toggleAllBlack: () => void;
  playTrack: (track: DownloadRecord) => void;
  logout: () => Promise<void>;
}) {
  const completed = downloads.filter((item) => item.status === "completed" && item.filePath);
  const [logoutBusy, setLogoutBusy] = useState(false);

  useEffect(() => {
    if (!installHelp) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeInstallHelp();
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [installHelp, closeInstallHelp]);

  return (
    <section className="settings-view">
      <div className="screen-topbar">
        <button className="icon-button pressable" onClick={openMain} title="Voltar">
          <ArrowLeft size={22} />
        </button>
        <h2>Configurações</h2>
        <span />
      </div>

      <button className={`settings-option theme-option pressable ${allBlack ? "active" : ""}`} type="button" onClick={toggleAllBlack}>
        <span className="settings-option-icon">
          <Moon size={23} />
        </span>
        <span>
          <strong>ALL BLACK</strong>
          <small>Deixar detalhes do app em cinza</small>
        </span>
        <span className="theme-status">{allBlack ? "ON" : "OFF"}</span>
      </button>

      <div className="settings-account">
        <span>
          <small>Conta conectada</small>
          <strong>{username}</strong>
        </span>
        <button
          className="settings-logout pressable"
          type="button"
          disabled={logoutBusy}
          onClick={async () => {
            setLogoutBusy(true);
            try {
              await logout();
            } finally {
              setLogoutBusy(false);
            }
          }}
        >
          {logoutBusy ? "Saindo..." : "Sair"}
        </button>
      </div>

      <button
        className="settings-option install-option pressable"
        type="button"
        onClick={installApp}
        disabled={installState === "installed" || installState === "installing"}
      >
        <span className="settings-option-icon">
          {installState === "installed" ? (
            <Check size={23} />
          ) : installState === "installing" ? (
            <Loader2 className="spin" size={23} />
          ) : (
            <Download size={23} />
          )}
        </span>
        <span>
          <strong>
            {installState === "installed"
              ? "Aplicativo instalado"
              : installState === "installing"
                ? "Aguardando autorização"
                : "Instalar aplicativo"}
          </strong>
          <small>
            {installState === "available"
              ? "Clique uma vez e autorize na janela do navegador"
              : installState === "installing"
                ? "Confirme a instalação na janela aberta"
              : installState === "installed"
                ? "Você está usando a versão instalada"
                : installState === "ios"
                  ? "Adicionar o Esporte Fai à Tela de Início"
                  : "Este navegador não oferece instalação automática"}
          </small>
        </span>
        <span className={`install-status ${installState}`}>
          {installState === "installed"
            ? "OK"
            : installState === "installing"
              ? "..."
              : installState === "ios"
                ? "iOS"
                : installState === "manual"
                  ? "MENU"
                  : "PWA"}
        </span>
      </button>

      {installHelp && (
        <div className="overlay centered install-help-overlay" onClick={closeInstallHelp}>
          <section
            className="install-help"
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-help-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="install-help-header">
              <span className="settings-option-icon">
                {installHelp === "ios" ? <Download size={23} /> : <MoreVertical size={23} />}
              </span>
              <div>
                <strong id="install-help-title">
                  {installHelp === "ios" ? "Instalar no iPhone ou iPad" : "Instalar pelo navegador"}
                </strong>
                <span>
                  {installHelp === "ios"
                    ? "Adicione o Esporte Fai à sua Tela de Início."
                    : "Abra o site em um navegador que permita instalar PWAs."}
                </span>
              </div>
              <button className="icon-button pressable" type="button" onClick={closeInstallHelp} title="Fechar instruções">
                <X size={18} />
              </button>
            </div>

            <ol className="install-help-steps">
              {installHelp === "ios" ? (
                <>
                  <li>
                    Toque no botão <strong>Compartilhar</strong> do Safari.
                  </li>
                  <li>
                    Escolha <strong>Adicionar à Tela de Início</strong>.
                  </li>
                  <li>
                    Confirme tocando em <strong>Adicionar</strong>.
                  </li>
                </>
              ) : (
                <>
                  <li>
                    Abra <strong>e.duk4rt.com</strong> diretamente no Chrome ou Edge.
                  </li>
                  <li>
                    Volte a <strong>Configurações</strong> e toque em <strong>Instalar aplicativo</strong>.
                  </li>
                  <li>Confirme a instalação na janela nativa do navegador.</li>
                </>
              )}
            </ol>

            <p>A instalação é opcional. Você pode continuar usando normalmente a versão web.</p>
            <button className="install-help-confirm pressable" type="button" onClick={closeInstallHelp}>
              Continuar na versão web
            </button>
          </section>
        </div>
      )}

      <button className="settings-option pressable" type="button" onClick={loadHistory}>
        <span className="settings-option-icon">
          <History size={23} />
        </span>
        <span>
          <strong>Historico de musicas baixadas</strong>
          <small>Carregar arquivos salvos anteriormente</small>
        </span>
      </button>

      {historyLoaded && (
        <div className="settings-history">
          <div className="settings-history-header">
            <strong>Historico</strong>
            <button className="small-toggle-button pressable" type="button" onClick={closeHistory} title="Ocultar historico">
              <X size={15} />
              <span>Ocultar</span>
            </button>
          </div>
          {completed.length === 0 ? (
            <div className="empty-state">
              <strong>Nenhuma musica baixada.</strong>
              <span>Os downloads concluidos vao aparecer aqui.</span>
            </div>
          ) : (
            completed.map((track) => (
              <button className="history-row pressable" key={track.idDownload} type="button" onClick={() => playTrack(track)}>
                <div className="track-art">{track.type === "video" ? <Video size={20} /> : <Headphones size={20} />}</div>
                <div>
                  <strong>{track.title}</strong>
                  <span>
                    {track.type === "video" ? "Video" : "Audio"} - {formatDateTime(track.completedAt || track.createdAt)}
                  </span>
                </div>
                <Play size={19} fill="currentColor" />
              </button>
            ))
          )}
        </div>
      )}
    </section>
  );
}

function BottomSheet({
  playlists,
  selection,
  setSelection,
  close,
  confirm,
  createNew
}: {
  playlists: UserPlaylist[];
  selection: string[];
  setSelection: (value: string[]) => void;
  close: () => void;
  confirm: () => void;
  createNew: () => void;
}) {
  return (
    <div className="overlay">
      <section className="bottom-sheet">
        <div className="sheet-header">
          <strong>Adicionar a playlist</strong>
          <button className="icon-button pressable" onClick={close}>
            <X size={20} />
          </button>
        </div>
        <div className="sheet-list">
          {playlists.map((playlist) => {
            const selected = selection.includes(playlist.id);
            return (
              <button
                className="sheet-row pressable"
                key={playlist.id}
                onClick={() => setSelection(selected ? selection.filter((id) => id !== playlist.id) : [...selection, playlist.id])}
              >
                <span className={`checkbox ${selected ? "selected" : ""}`}>{selected && <Check size={15} />}</span>
                {playlist.name}
              </button>
            );
          })}
          <button className="sheet-row pressable" onClick={createNew}>
            <Plus size={18} />
            Nova Playlist
          </button>
        </div>
        <button className="confirm-button pressable" onClick={confirm} disabled={!selection.length}>
          Adicionar
        </button>
      </section>
    </div>
  );
}

function Modal({
  title,
  value,
  setValue,
  close,
  confirm
}: {
  title: string;
  value: string;
  setValue: (value: string) => void;
  close: () => void;
  confirm: () => void;
}) {
  return (
    <div className="overlay centered">
      <section className="modal">
        <strong>{title}</strong>
        <label>
          Nome
          <input value={value} onChange={(event) => setValue(event.target.value)} autoFocus />
        </label>
        <div className="modal-actions">
          <button className="plain-button pressable" onClick={close}>
            Cancelar
          </button>
          <button className="confirm-button pressable" onClick={confirm}>
            Criar
          </button>
        </div>
      </section>
    </div>
  );
}

function AudioBars() {
  return (
    <span className="audio-bars">
      <i />
      <i />
      <i />
    </span>
  );
}

function MusicGlyph() {
  return (
    <span className="music-glyph">
      <Headphones size={72} />
    </span>
  );
}

export { HomeView, PlaylistsView, PlaylistDetailView, PlayerView, PlayerReturnTab, SettingsView, BottomSheet, Modal };
