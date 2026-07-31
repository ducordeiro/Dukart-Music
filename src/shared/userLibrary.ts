import type { DownloadRecord, UserPlaylist, UserPlaylistTrack } from "./types";
import { isSupportedYoutubeUrl, youtubeVideoId } from "./youtube";

export const LIKED_PLAYLIST_ID = "liked";

const MAX_PLAYLISTS = 200;
const MAX_ITEMS_PER_PLAYLIST = 10_000;
const MAX_COVER_LENGTH = 900_000;
const MAX_LIBRARY_LENGTH = 1_000_000;

export function createLikedPlaylist(createdAt = new Date().toISOString()): UserPlaylist {
  return {
    id: LIKED_PLAYLIST_ID,
    name: "Musicas Curtidas",
    itemIds: [],
    items: [],
    special: "liked",
    createdAt
  };
}

export function parseUserPlaylists(value: unknown): UserPlaylist[] {
  if (!Array.isArray(value) || value.length > MAX_PLAYLISTS || JSON.stringify(value).length > MAX_LIBRARY_LENGTH) {
    throw new Error("Biblioteca de playlists invalida.");
  }

  const ids = new Set<string>();
  const playlists = value.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Playlist invalida.");
    }

    const candidate = entry as Partial<UserPlaylist>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    if (!id || id.length > 128 || ids.has(id)) {
      throw new Error("Identificador de playlist invalido.");
    }
    if (!name || name.length > 100) {
      throw new Error("Nome de playlist invalido.");
    }
    ids.add(id);

    if (!Array.isArray(candidate.itemIds) || candidate.itemIds.length > MAX_ITEMS_PER_PLAYLIST) {
      throw new Error("Lista de musicas invalida.");
    }
    const itemIds = Array.from(new Set(candidate.itemIds));
    if (itemIds.some((itemId) => !Number.isSafeInteger(itemId) || itemId <= 0)) {
      throw new Error("Musica de playlist invalida.");
    }

    let items: UserPlaylistTrack[] | undefined;
    if (candidate.items !== undefined) {
      if (!Array.isArray(candidate.items) || candidate.items.length > MAX_ITEMS_PER_PLAYLIST) {
        throw new Error("Musicas sincronizadas da playlist invalidas.");
      }
      const itemKeys = new Set<string>();
      items = candidate.items.map((item) => {
        if (!item || typeof item !== "object") throw new Error("Musica sincronizada invalida.");
        const track = item as Partial<UserPlaylistTrack>;
        const type = track.type === "audio" || track.type === "video" ? track.type : null;
        const url = typeof track.url === "string" ? track.url.trim() : "";
        const expectedKey = type ? playlistTrackKey(url, type) : "";
        if (
          !type ||
          !isSupportedYoutubeUrl(url) ||
          typeof track.key !== "string" ||
          track.key !== expectedKey ||
          itemKeys.has(track.key)
        ) {
          throw new Error("Identificador de musica sincronizada invalido.");
        }
        const title = typeof track.title === "string" ? track.title.trim() : "";
        const channel = typeof track.channel === "string" ? track.channel.trim() : "";
        if (!title || title.length > 300 || channel.length > 200) {
          throw new Error("Dados de musica sincronizada invalidos.");
        }
        itemKeys.add(track.key);
        return { key: track.key, url, title, channel, type };
      });
    }

    const createdAt = typeof candidate.createdAt === "string" ? candidate.createdAt : "";
    if (!createdAt || createdAt.length > 64 || !Number.isFinite(Date.parse(createdAt))) {
      throw new Error("Data de criacao da playlist invalida.");
    }

    const isLiked = id === LIKED_PLAYLIST_ID;
    if (candidate.special !== undefined && candidate.special !== "liked") {
      throw new Error("Tipo de playlist invalido.");
    }
    if (candidate.special === "liked" && !isLiked) {
      throw new Error("Playlist especial invalida.");
    }

    let coverImage: string | undefined;
    if (candidate.coverImage !== undefined) {
      if (
        typeof candidate.coverImage !== "string" ||
        candidate.coverImage.length > MAX_COVER_LENGTH ||
        !candidate.coverImage.startsWith("data:image/")
      ) {
        throw new Error("Capa de playlist invalida.");
      }
      coverImage = candidate.coverImage;
    }

    return {
      id,
      name,
      itemIds,
      ...(items ? { items } : {}),
      ...(isLiked ? { special: "liked" as const } : {}),
      ...(coverImage ? { coverImage } : {}),
      createdAt
    };
  });

  if (!ids.has(LIKED_PLAYLIST_ID) && playlists.length >= MAX_PLAYLISTS) {
    throw new Error("Biblioteca de playlists invalida.");
  }
  if (!ids.has(LIKED_PLAYLIST_ID)) {
    playlists.unshift(createLikedPlaylist());
  }
  return playlists;
}

export function playlistTrackKey(url: string, type: "audio" | "video") {
  const videoId = youtubeVideoId(url);
  return videoId ? `${type}:${videoId}` : "";
}

export function playlistTrackFromDownload(
  track: Pick<DownloadRecord, "url" | "title" | "channel" | "type">
): UserPlaylistTrack {
  const key = playlistTrackKey(track.url, track.type);
  if (!key) throw new Error("Nao foi possivel identificar a musica.");
  return {
    key,
    url: track.url,
    title: track.title,
    channel: track.channel,
    type: track.type
  };
}

export function playlistContainsDownload(playlist: UserPlaylist, track: DownloadRecord) {
  if (playlist.items !== undefined) {
    return playlist.items.some((item) => item.key === playlistTrackKey(track.url, track.type));
  }
  return playlist.itemIds.includes(track.idDownload);
}

export function mergeUserPlaylists(
  baseValue: UserPlaylist[],
  localValue: UserPlaylist[],
  remoteValue: UserPlaylist[]
) {
  const base = parseUserPlaylists(baseValue);
  const local = parseUserPlaylists(localValue);
  const remote = parseUserPlaylists(remoteValue);
  const baseById = new Map(base.map((playlist) => [playlist.id, playlist]));
  const localById = new Map(local.map((playlist) => [playlist.id, playlist]));
  const remoteById = new Map(remote.map((playlist) => [playlist.id, playlist]));
  const orderedIds = Array.from(
    new Set([
      LIKED_PLAYLIST_ID,
      ...local.map((playlist) => playlist.id),
      ...remote.map((playlist) => playlist.id),
      ...base.map((playlist) => playlist.id)
    ])
  );

  const merged = orderedIds.flatMap((id) => {
    const basePlaylist = baseById.get(id);
    const localPlaylist = localById.get(id);
    const remotePlaylist = remoteById.get(id);

    if (!basePlaylist) {
      if (localPlaylist && remotePlaylist) {
        return [mergePlaylist(createEmptyMergeBase(localPlaylist), localPlaylist, remotePlaylist)];
      }
      return localPlaylist ? [localPlaylist] : remotePlaylist ? [remotePlaylist] : [];
    }
    if (!localPlaylist && !remotePlaylist) return [];
    if (!localPlaylist) {
      return playlistsEqual(remotePlaylist, basePlaylist) ? [] : remotePlaylist ? [remotePlaylist] : [];
    }
    if (!remotePlaylist) {
      return playlistsEqual(localPlaylist, basePlaylist) ? [] : [localPlaylist];
    }
    return [mergePlaylist(basePlaylist, localPlaylist, remotePlaylist)];
  });

  return parseUserPlaylists(merged);
}

function mergePlaylist(base: UserPlaylist, local: UserPlaylist, remote: UserPlaylist): UserPlaylist {
  const mergedItems = mergePlaylistItems(base.items, local.items, remote.items);
  return {
    id: local.id,
    name: mergeValue(base.name, local.name, remote.name),
    // Download IDs only have meaning on the current device. Stable track
    // references in `items` are what is synchronized between devices.
    itemIds: local.itemIds,
    ...(mergedItems !== undefined ? { items: mergedItems } : {}),
    ...(local.id === LIKED_PLAYLIST_ID ? { special: "liked" as const } : {}),
    ...mergeOptionalProperty("coverImage", base, local, remote),
    createdAt: mergeValue(base.createdAt, local.createdAt, remote.createdAt)
  };
}

function mergePlaylistItems(
  baseItems: UserPlaylistTrack[] | undefined,
  localItems: UserPlaylistTrack[] | undefined,
  remoteItems: UserPlaylistTrack[] | undefined
) {
  if (baseItems === undefined && localItems === undefined && remoteItems === undefined) return undefined;

  const base = new Map((baseItems || []).map((item) => [item.key, item]));
  const local = new Map((localItems || []).map((item) => [item.key, item]));
  const remote = new Map((remoteItems || []).map((item) => [item.key, item]));
  const keys = Array.from(new Set([...local.keys(), ...remote.keys(), ...base.keys()]));

  return keys.flatMap((key) => {
    const baseHas = base.has(key);
    const localHas = local.has(key);
    const remoteHas = remote.has(key);
    const keep = localHas === baseHas ? remoteHas : remoteHas === baseHas ? localHas : localHas;
    if (!keep) return [];
    return [local.get(key) || remote.get(key) || base.get(key)!];
  });
}

function mergeOptionalProperty(
  key: "coverImage",
  base: UserPlaylist,
  local: UserPlaylist,
  remote: UserPlaylist
): Pick<UserPlaylist, "coverImage"> {
  const value = mergeValue(base[key], local[key], remote[key]);
  return value === undefined ? {} : { [key]: value };
}

function mergeValue<T>(base: T, local: T, remote: T) {
  if (valuesEqual(local, base)) return remote;
  if (valuesEqual(remote, base)) return local;
  return local;
}

function createEmptyMergeBase(playlist: UserPlaylist): UserPlaylist {
  return {
    id: playlist.id,
    name: "",
    itemIds: [],
    items: [],
    createdAt: playlist.createdAt
  };
}

function playlistsEqual(left: UserPlaylist | undefined, right: UserPlaylist | undefined) {
  return valuesEqual(left, right);
}

function valuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}
