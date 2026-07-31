import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  Download,
  FileDown,
  FolderPlus,
  Headphones,
  Heart,
  History,
  House,
  Library,
  ListMusic,
  Loader2,
  MoreVertical,
  Moon,
  Pause,
  Play,
  Plus,
  Repeat2,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Video,
  X
} from "lucide-react";
import type { DownloadRecord, DownloadStatus, DownloadType, UserPlaylistTrack, YoutubeSearchResult } from "../shared/types";
import type { Status, UserPlaylist } from "./types";
import { formatDateTime, formatMb, formatTime } from "./utils";
import { clearOfflineStorage, readDeviceStorage } from "./offlineMedia";

function useDialogDismiss(close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, []);
}

function HomeView({
  username,
  recentTracks,
  playlists,
  playTrack,
  openPlaylist,
  openSettings
}: {
  username: string;
  recentTracks: DownloadRecord[];
  playlists: UserPlaylist[];
  playTrack: (track: DownloadRecord) => void;
  openPlaylist: (id: string) => void;
  openSettings: () => void;
}) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  return (
    <section className="home-view" aria-labelledby="home-greeting">
      <header className="home-header">
        <img className="home-logo" src="./esporte-fai-logo.png" alt="Esporte Fai" />
        <div className="home-greeting">
          <span id="home-greeting">{greeting}</span>
          <strong>@{username}</strong>
        </div>
        <button className="avatar-button pressable" type="button" onClick={openSettings} title="Abrir configurações" aria-label="Abrir configurações">
          {username.slice(0, 1).toUpperCase()}
        </button>
      </header>

      <section className="home-section" aria-labelledby="recent-title">
        <div className="section-heading">
          <div>
            <span className="section-eyebrow">Continue ouvindo</span>
            <h2 id="recent-title">Últimas músicas ouvidas</h2>
          </div>
        </div>
        {recentTracks.length ? (
          <div className="recent-grid">
            {recentTracks.slice(0, 4).map((track) => (
              <button className="recent-card pressable" type="button" key={track.idDownload} onClick={() => playTrack(track)}>
                <span className={`recent-art ${track.type}`} aria-hidden="true">
                  {track.type === "video" ? <Video size={24} /> : <Headphones size={24} />}
                </span>
                <span className="recent-copy">
                  <strong>{track.title}</strong>
                  <small>{track.channel || "Esporte Fai"}</small>
                </span>
                <Play className="recent-play" fill="currentColor" size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state home-empty">
            <Headphones size={26} />
            <strong>Nenhuma música ouvida ainda</strong>
            <span>Use a aba Buscar para encontrar ou baixar sua primeira faixa.</span>
          </div>
        )}
      </section>

      <section className="home-section" aria-labelledby="home-playlists-title">
        <div className="section-heading">
          <div>
            <span className="section-eyebrow">Feitas por você</span>
            <h2 id="home-playlists-title">Suas playlists</h2>
          </div>
        </div>
        {playlists.length ? (
          <div className="home-playlist-carousel">
            {playlists.map((playlist) => (
              <button className="home-playlist-card pressable" type="button" key={playlist.id} onClick={() => openPlaylist(playlist.id)}>
                <span className={`home-playlist-cover ${playlist.special ? "liked" : ""}`}>
                  <PlaylistCoverContent playlist={playlist} iconSize={30} />
                </span>
                <strong>{playlist.name}</strong>
                <small>{playlist.itemIds.length} itens</small>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state home-empty">
            <ListMusic size={26} />
            <strong>Sua biblioteca está vazia</strong>
            <span>Crie playlists para encontrá-las rapidamente aqui.</span>
          </div>
        )}
      </section>
    </section>
  );
}

function SearchView({
  url,
  setUrl,
  validUrl,
  musicSearch,
  setMusicSearch,
  musicResults,
  musicSearchLoading,
  musicSearchError,
  recentSearches,
  selectedMusic,
  runMusicSearch,
  selectMusic,
  playResult,
  canPlayLatest,
  audioSize,
  videoSize,
  status,
  progress,
  message,
  downloadTasks,
  cancelDownload,
  retryDownload,
  startDownload,
  playLatest,
  cancelSearch,
  removeRecentSearch
}: {
  url: string;
  setUrl: (value: string) => void;
  validUrl: boolean;
  musicSearch: string;
  setMusicSearch: (value: string) => void;
  musicResults: YoutubeSearchResult[];
  musicSearchLoading: boolean;
  musicSearchError: string;
  recentSearches: YoutubeSearchResult[];
  selectedMusic: YoutubeSearchResult | null;
  runMusicSearch: () => void;
  selectMusic: (result: YoutubeSearchResult) => void;
  playResult: (result: YoutubeSearchResult) => void;
  canPlayLatest: boolean;
  audioSize: number | null;
  videoSize: number | null;
  status: Record<DownloadType | "play", Status>;
  progress: Record<DownloadType, number>;
  message: string;
  downloadTasks: Array<{ idDownload: number; url: string; title: string; type: DownloadType; status: DownloadStatus; progress: number; message?: string }>;
  cancelDownload: (task: { idDownload: number; url: string; title: string; type: DownloadType; status: DownloadStatus; progress: number; message?: string }) => void;
  retryDownload: (task: { idDownload: number; url: string; title: string; type: DownloadType; status: DownloadStatus; progress: number; message?: string }) => void;
  startDownload: (type: DownloadType) => void;
  playLatest: () => void;
  cancelSearch: () => void;
  removeRecentSearch: (videoId: string) => void;
}) {
  const [resultsCollapsed, setResultsCollapsed] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const localSuggestions = musicSearch.trim() && !validUrl
    ? recentSearches.filter((result) => `${result.titulo} ${result.canal}`.toLowerCase().includes(musicSearch.trim().toLowerCase()))
    : [];

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (musicResults.length > 0) {
      setResultsCollapsed(false);
    }
  }, [musicResults]);

  return (
    <section className="main-panel search-view" aria-label="Buscar e baixar músicas">
      <header className="search-page-header">
        <div>
          <span className="section-eyebrow">Descobrir</span>
          <h1>Buscar</h1>
        </div>
      </header>
      <div className="music-search-panel">
        <div className="music-search-row">
          <div className="music-search-box">
            <Search size={18} />
            <input
              ref={searchInputRef}
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
              placeholder="Busque uma música ou cole um link do YouTube"
              disabled={musicSearchLoading}
            />
          </div>
          <button className="music-search-submit pressable" type="button" onClick={runMusicSearch} disabled={musicSearchLoading} aria-label="Buscar ou reconhecer link">
            {musicSearchLoading ? (
              <Loader2 className="spin" size={18} />
            ) : (
              <>
                <CornerDownLeft size={17} />
                <span>Enter</span>
              </>
            )}
          </button>
          <button
            className="search-cancel pressable"
            type="button"
            onClick={() => {
              cancelSearch();
              searchInputRef.current?.blur();
            }}
          >
            Cancelar
          </button>
        </div>

        {(musicSearchLoading || musicSearchError) && (
          <p className={`search-feedback ${musicSearchError ? "error" : ""}`}>
            {musicSearchLoading ? "Buscando..." : musicSearchError}
          </p>
        )}

        {musicSearch.trim() && musicResults.length > 0 && (
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

        {musicSearch.trim() && musicResults.length > 0 && !resultsCollapsed && (
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
                  <div className="music-result-actions">
                    <button className="select-result-button pressable" type="button" onClick={() => selectMusic(result)}>
                      {selected ? <Check size={17} /> : "Selecionar"}
                    </button>
                    <button className="play-result-button pressable" type="button" onClick={() => playResult(result)} aria-label={`Tocar ${result.titulo}`}>
                      <Play size={16} fill="currentColor" />
                      <span>Tocar</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {musicSearch.trim() && !musicSearchLoading && musicResults.length === 0 && localSuggestions.length > 0 && (
        <div className="local-suggestions" aria-label="Sugestões do histórico">
          <small>Sugestões recentes</small>
          {localSuggestions.map((result) => (
            <button key={result.videoId} className="local-suggestion pressable" type="button" onClick={() => selectMusic(result)}>
              <History size={15} />
              <span>{result.titulo}</span>
            </button>
          ))}
        </div>
      )}

      {!musicSearch.trim() && !musicSearchLoading && (
        <section className="recent-searches" aria-labelledby="recent-searches-title">
          <div className="recent-searches-heading">
            <History size={18} />
            <h2 id="recent-searches-title">Buscas recentes</h2>
          </div>
          {recentSearches.length ? (
            <div className="recent-search-list">
              {recentSearches.map((result) => (
                <article className="recent-search-row" key={result.videoId}>
                  <button className="recent-search-main pressable" type="button" onClick={() => selectMusic(result)}>
                    {result.thumbnail ? <img src={result.thumbnail} alt="" /> : <span className="music-result-fallback"><Headphones size={19} /></span>}
                    <span>
                      <strong>{result.titulo}</strong>
                      <small>Música · {result.canal || "YouTube"}</small>
                    </span>
                  </button>
                  <button className="recent-search-remove pressable" type="button" onClick={() => removeRecentSearch(result.videoId)} title="Remover busca recente" aria-label={`Remover ${result.titulo} das buscas recentes`}>
                    <X size={18} />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="search-placeholder-state">
              <Search size={20} />
              <div>
                <strong>Nenhuma busca recente</strong>
                <span>As músicas selecionadas ficam salvas somente neste aparelho e nesta conta.</span>
              </div>
            </div>
          )}
        </section>
      )}

      <div className="download-section-heading">
        <span className="section-eyebrow">{validUrl ? "Link pronto" : "Ações"}</span>
        <h2>{selectedMusic?.titulo || (validUrl ? "Escolha o formato" : "Selecione uma música acima")}</h2>
      </div>

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

      <div className="message" role="status">
        {message}
      </div>

      {downloadTasks.length > 0 && (
        <section className="download-manager" aria-labelledby="download-manager-title">
          <h2 id="download-manager-title">Downloads</h2>
          {downloadTasks.map((task) => (
            <div className="download-task" key={task.idDownload}>
              <div><strong>{task.title}</strong><small>{task.type === "audio" ? "Áudio" : "Vídeo"} · {task.status}</small></div>
              <progress max="100" value={task.progress} aria-label={`Progresso de ${task.title}`} />
              {task.status === "downloading" || task.status === "pending" ? (
                <button className="plain-button pressable" type="button" onClick={() => cancelDownload(task)}>Cancelar</button>
              ) : task.status === "failed" || task.status === "cancelled" ? (
                <button className="plain-button pressable" type="button" onClick={() => retryDownload(task)}>Tentar novamente</button>
              ) : <Check size={18} aria-label="Concluído" />}
            </div>
          ))}
        </section>
      )}
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
  username,
  openPlaylist,
  createPlaylist,
  updatePlaylistCover
}: {
  playlists: UserPlaylist[];
  downloads: DownloadRecord[];
  username: string;
  openPlaylist: (id: string) => void;
  createPlaylist: () => void;
  updatePlaylistCover: (playlistId: string, file: File) => void;
}) {
  const [librarySearchOpen, setLibrarySearchOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const visiblePlaylists = playlists.filter((playlist) => playlist.name.toLowerCase().includes(libraryQuery.trim().toLowerCase()));

  return (
    <section className="library-view">
      <div className="library-header">
        <div>
          <span className="section-eyebrow">Coleção</span>
          <h1>Sua Biblioteca</h1>
        </div>
        <div className="library-header-actions">
          <button className="icon-button pressable" type="button" onClick={() => setLibrarySearchOpen((value) => !value)} title="Buscar na biblioteca" aria-expanded={librarySearchOpen}>
            <Search size={21} />
          </button>
          <button className="avatar-button pressable" type="button" title={`Usuário @${username}`} aria-label={`Usuário @${username}`}>
            {username.slice(0, 1).toUpperCase()}
          </button>
        </div>
      </div>
      {librarySearchOpen && (
        <label className="library-search-box">
          <Search size={18} />
          <input autoFocus value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Buscar na sua biblioteca" />
          {libraryQuery && <button className="library-search-clear" type="button" onClick={() => setLibraryQuery("")} title="Limpar busca"><X size={17} /></button>}
        </label>
      )}
      <div className="library-toolbar">
        <span>{visiblePlaylists.length} {visiblePlaylists.length === 1 ? "playlist" : "playlists"}</span>
        <button className="library-create pressable" type="button" onClick={createPlaylist}><Plus size={18} /> Nova playlist</button>
      </div>
      <div className="playlist-grid">
        {visiblePlaylists.map((playlist) => {
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
      {visiblePlaylists.length === 0 && (
        <div className="empty-state library-empty">
          <Search size={24} />
          <strong>Nenhum item encontrado</strong>
          <span>Tente outro nome ou crie uma nova playlist.</span>
        </div>
      )}
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
  offlinePlaylistBusy,
  offlinePlaylistComplete,
  offlinePlaylistProgress,
  offlinePlaylistTotal,
  offlineSupported,
  togglePlaylistOffline,
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
  offlinePlaylistBusy: boolean;
  offlinePlaylistComplete: boolean;
  offlinePlaylistProgress: { mode: "saving" | "removing"; completed: number; total: number; receivedBytes?: number; totalBytes?: number } | null;
  offlinePlaylistTotal: number;
  offlineSupported: boolean;
  togglePlaylistOffline: () => void;
  saveAudioOffline: (track: DownloadRecord) => void;
  removeAudioOffline: (track: DownloadRecord) => void;
  syncedDownloadBusyKey: string | null;
  downloadSyncedTrack: (track: UserPlaylistTrack) => void;
  updatePlaylistCover: (playlistId: string, file: File) => void;
}) {
  return (
    <section className="playlist-detail">
      <div className="screen-topbar">
        <button className="icon-button pressable" onClick={back} title="Voltar" aria-label="Voltar">
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
          <button
            className={`playlist-offline-button pressable ${offlinePlaylistComplete ? "saved" : ""}`}
            type="button"
            onClick={togglePlaylistOffline}
            disabled={!offlineSupported || !offlinePlaylistTotal || offlinePlaylistProgress?.mode === "removing"}
            aria-pressed={offlinePlaylistComplete}
            title={
              !offlineSupported
                ? "Disponivel no PWA ou navegador"
                : !offlinePlaylistTotal
                  ? "Nenhum audio disponivel para uso offline"
                : offlinePlaylistComplete
                  ? "Remover playlist do offline"
                  : "Baixar playlist para ouvir offline"
            }
          >
            {offlinePlaylistBusy ? (
              <X size={18} />
            ) : offlinePlaylistComplete ? (
              <Check size={18} />
            ) : (
              <Download size={18} />
            )}
            <span>
              {offlinePlaylistProgress
                ? `${offlinePlaylistProgress.mode === "saving" ? "Baixando" : "Removendo"} ${offlinePlaylistProgress.completed}/${offlinePlaylistProgress.total}${offlinePlaylistProgress.receivedBytes ? ` · ${formatMb(offlinePlaylistProgress.receivedBytes)}` : ""}`
                : offlinePlaylistComplete
                  ? "Offline"
                  : "Baixar"}
            </span>
          </button>
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
                <div className={`track-row pressable ${currentTrack?.idDownload === track.idDownload ? "active" : ""}`} key={track.idDownload} onClick={() => playTrack(track)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); playTrack(track); } }} role="button" tabIndex={0} aria-label={`Tocar ${track.title}`}>
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
                      disabled={offlineBusy || offlinePlaylistBusy}
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
  artwork,
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
  openQueue,
  toggleRepeat,
  isOfflineSaved,
  offlineBusy,
  saveOffline,
  removeOffline,
  downloadFile,
  fileDownloadBusy,
  mediaRef,
  mediaUrl,
  onTimeUpdate,
  onDurationChange,
  onPlayStateChange,
  onMediaError,
  onEnded
}: {
  track: DownloadRecord | null;
  artwork: string;
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
  openQueue: () => void;
  toggleRepeat: () => void;
  isOfflineSaved: boolean;
  offlineBusy: boolean;
  saveOffline: () => void;
  removeOffline: () => void;
  downloadFile: () => void;
  fileDownloadBusy: boolean;
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
        <button className="icon-button pressable" onClick={back} title="Voltar" aria-label="Voltar">
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
          <button
            className="icon-button pressable file-download-top"
            onClick={downloadFile}
            title={`Baixar arquivo ${track?.type === "video" ? "MP4" : "MP3"} no dispositivo`}
            disabled={!track || fileDownloadBusy}
          >
            {fileDownloadBusy ? <Loader2 className="spin" size={20} /> : <FileDown size={21} />}
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
          <button className={`album-art pressable ${artwork ? "has-image" : ""}`} onDoubleClick={toggleFavorite} title="Toque duplo para favoritar">
            {artwork ? <img className="album-art-image" src={artwork} alt="Capa da playlist atual" /> : <MusicGlyph />}
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
          aria-label="Posição da reprodução"
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
        <button className="icon-button secondary pressable" onClick={openQueue} disabled={!track} title="Abrir fila" aria-label="Abrir fila de reprodução">
          <ListMusic size={23} />
        </button>
      </div>
    </section>
  );
}

function PlayerReturnTab({
  track,
  artwork,
  isPlaying,
  currentTime,
  duration,
  openPlayer,
  togglePlayback
}: {
  track: DownloadRecord;
  artwork: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  openPlayer: () => void;
  togglePlayback: () => void;
}) {
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  return (
    <section className="player-return-tab" aria-label="Miniplayer">
      <button className="mini-player-main pressable" type="button" onClick={openPlayer}>
        <span className={`player-return-icon ${artwork ? "has-image" : ""}`}>
          {artwork ? <img src={artwork} alt="" /> : isPlaying ? <AudioBars /> : track.type === "video" ? <Video size={19} /> : <Headphones size={19} />}
        </span>
        <span className="mini-player-copy">
          <strong>{track.title}</strong>
          <small>{track.channel || "Esporte Fai"}</small>
        </span>
      </button>
      <button className="mini-player-toggle pressable" type="button" onClick={togglePlayback} title={isPlaying ? "Pausar" : "Reproduzir"} aria-label={isPlaying ? "Pausar" : "Reproduzir"}>
        {isPlaying ? <Pause fill="currentColor" size={21} /> : <Play fill="currentColor" size={21} />}
      </button>
      <span className="mini-player-progress" aria-hidden="true"><i style={{ width: `${progress}%` }} /></span>
    </section>
  );
}

function BottomNavigation({ activeView, navigate }: { activeView: "main" | "search" | "playlists"; navigate: (view: "main" | "search" | "playlists") => void }) {
  const items = [
    { id: "main" as const, label: "Início", icon: <House size={22} /> },
    { id: "search" as const, label: "Buscar", icon: <Search size={22} /> },
    { id: "playlists" as const, label: "Sua Biblioteca", icon: <Library size={22} /> }
  ];
  return (
    <nav className="bottom-navigation" aria-label="Navegação principal">
      {items.map((item) => (
        <button className={`bottom-nav-item pressable ${activeView === item.id ? "active" : ""}`} type="button" key={item.id} onClick={() => navigate(item.id)} aria-current={activeView === item.id ? "page" : undefined}>
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function SettingsView({
  idUser,
  username,
  downloads,
  historyLoaded,
  historyLoading,
  historyError,
  fullHistory,
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
  downloadFile,
  fileDownloadBusyId,
  logout
}: {
  idUser: number;
  username: string;
  downloads: DownloadRecord[];
  historyLoaded: boolean;
  historyLoading: boolean;
  historyError: string;
  fullHistory: boolean;
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
  downloadFile: (track: DownloadRecord) => void;
  fileDownloadBusyId: number | null;
  logout: () => Promise<void>;
}) {
  const completed = downloads.filter((item) => item.status === "completed");
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [deviceStorage, setDeviceStorage] = useState<{ offlineBytes: number; offlineFiles: number; usage: number; quota: number } | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);

  async function loadDeviceStorage() {
    setStorageBusy(true);
    try {
      setDeviceStorage(await readDeviceStorage(idUser));
    } finally {
      setStorageBusy(false);
    }
  }

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
        <button className="icon-button pressable" onClick={openMain} title="Voltar" aria-label="Voltar">
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

      <button className="settings-option pressable" type="button" onClick={loadDeviceStorage} disabled={storageBusy}>
        <span className="settings-option-icon"><Download size={23} /></span>
        <span>
          <strong>Armazenamento neste aparelho</strong>
          <small>{deviceStorage ? `${formatMb(deviceStorage.offlineBytes)} em ${deviceStorage.offlineFiles} arquivos offline` : "Ver uso, cota e arquivos offline"}</small>
        </span>
        {storageBusy ? <Loader2 className="spin" size={19} /> : <span className="theme-status">VER</span>}
      </button>

      {deviceStorage && (
        <div className="storage-panel">
          <span>Uso do site: <strong>{formatMb(deviceStorage.usage)}</strong></span>
          <span>Cota estimada: <strong>{formatMb(deviceStorage.quota)}</strong></span>
          <button className="plain-button pressable" type="button" disabled={!deviceStorage.offlineFiles} onClick={async () => {
            if (!window.confirm("Remover todas as músicas offline desta conta neste aparelho?")) return;
            await clearOfflineStorage(idUser);
            await loadDeviceStorage();
          }}>Remover todos os arquivos offline</button>
        </div>
      )}

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
          <small>{fullHistory ? "Visualizar todos os downloads do aplicativo" : "Visualizar somente os downloads desta conta"}</small>
        </span>
        {historyLoading && <Loader2 className="spin" size={19} />}
      </button>

      {historyLoaded && (
        <div className="settings-history">
          <div className="settings-history-header">
            <strong>{fullHistory ? "Historico completo" : "Seu historico"}</strong>
            <button className="small-toggle-button pressable" type="button" onClick={closeHistory} title="Ocultar historico">
              <X size={15} />
              <span>Ocultar</span>
            </button>
          </div>
          {historyLoading ? (
            <div className="empty-state history-loading-state">
              <Loader2 className="spin" size={25} />
              <strong>Carregando historico...</strong>
            </div>
          ) : historyError ? (
            <div className="empty-state">
              <strong>Nao foi possivel carregar o historico.</strong>
              <span>{historyError}</span>
            </div>
          ) : completed.length === 0 ? (
            <div className="empty-state">
              <strong>Nenhuma musica baixada.</strong>
              <span>Os downloads concluidos vao aparecer aqui.</span>
            </div>
          ) : (
            completed.map((track) => (
              <div
                className="history-row pressable"
                key={track.idDownload}
              >
                <div className="track-art">{track.type === "video" ? <Video size={20} /> : <Headphones size={20} />}</div>
                <div>
                  <strong>{track.title}</strong>
                  <span>
                    {track.type === "video" ? "Video" : "Audio"} - {formatDateTime(track.completedAt || track.createdAt)}
                  </span>
                </div>
                <div className="history-actions">
                  <button
                    className="history-action pressable"
                    type="button"
                    onClick={() => playTrack(track)}
                    disabled={!track.filePath}
                    title={track.filePath ? "Reproduzir" : "Arquivo disponivel somente em outro dispositivo"}
                  >
                    {track.filePath ? <Play size={18} fill="currentColor" /> : <History size={18} />}
                  </button>
                  <button
                    className="history-action download pressable"
                    type="button"
                    onClick={() => downloadFile(track)}
                    disabled={!track.filePath || fileDownloadBusyId === track.idDownload}
                    title={`Baixar ${track.type === "video" ? "MP4" : "MP3"} no dispositivo`}
                  >
                    {fileDownloadBusyId === track.idDownload ? <Loader2 className="spin" size={18} /> : <FileDown size={18} />}
                  </button>
                </div>
              </div>
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
  useDialogDismiss(close);
  return (
    <div className="overlay" onClick={close}>
      <section className="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="add-playlist-title" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-header">
          <strong id="add-playlist-title">Adicionar a playlist</strong>
          <button className="icon-button pressable" onClick={close} aria-label="Fechar">
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
  useDialogDismiss(close);
  return (
    <div className="overlay centered" onClick={close}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={(event) => event.stopPropagation()}>
        <strong id="modal-title">{title}</strong>
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

function QueueSheet({
  queue,
  currentTrackId,
  close,
  play,
  move,
  remove,
  clear
}: {
  queue: DownloadRecord[];
  currentTrackId?: number;
  close: () => void;
  play: (index: number) => void;
  move: (index: number, direction: -1 | 1) => void;
  remove: (index: number) => void;
  clear: () => void;
}) {
  useDialogDismiss(close);
  return (
    <div className="overlay" onClick={close}>
      <section className="bottom-sheet queue-sheet" role="dialog" aria-modal="true" aria-labelledby="queue-title" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-header">
          <strong id="queue-title">Fila de reprodução</strong>
          <button className="icon-button pressable" type="button" onClick={close} aria-label="Fechar fila"><X size={20} /></button>
        </div>
        <div className="queue-list">
          {queue.length ? queue.map((track, index) => (
            <div className={`queue-row ${track.idDownload === currentTrackId ? "active" : ""}`} key={`${track.idDownload}-${index}`}>
              <button className="queue-track pressable" type="button" onClick={() => play(index)}>
                <span>{index + 1}</span>
                <span><strong>{track.title}</strong><small>{track.channel || "Esporte Fai"}</small></span>
              </button>
              <div className="queue-actions">
                <button type="button" className="icon-button pressable" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Mover ${track.title} para cima`}><ChevronUp size={17} /></button>
                <button type="button" className="icon-button pressable" onClick={() => move(index, 1)} disabled={index === queue.length - 1} aria-label={`Mover ${track.title} para baixo`}><ChevronDown size={17} /></button>
                <button type="button" className="icon-button pressable" onClick={() => remove(index)} aria-label={`Remover ${track.title} da fila`}><X size={17} /></button>
              </div>
            </div>
          )) : <div className="empty-state"><ListMusic size={24} /><strong>A fila está vazia</strong></div>}
        </div>
        {queue.length > 0 && <button className="plain-button queue-clear pressable" type="button" onClick={clear}>Limpar fila</button>}
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

export { HomeView, SearchView, PlaylistsView, PlaylistDetailView, PlayerView, PlayerReturnTab, BottomNavigation, SettingsView, BottomSheet, Modal, QueueSheet };
