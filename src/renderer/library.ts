import { createLikedPlaylist, parseUserPlaylists } from "../shared/userLibrary";
import { STORAGE_KEY } from "./constants";
import type { UserPlaylist } from "../shared/types";

export function likedPlaylist(): UserPlaylist {
  return createLikedPlaylist();
}

export function loadLegacyLibrary(): UserPlaylist[] {
  try {
    return parseUserPlaylists(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return [likedPlaylist()];
  }
}

export function hasLegacyLibrary() {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

export function removeLegacyLibrary() {
  localStorage.removeItem(STORAGE_KEY);
}
