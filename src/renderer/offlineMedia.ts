import type { DownloadRecord } from "../shared/types";
import { MEDIA_CACHE, OFFLINE_KEY, OFFLINE_RECORDS_KEY } from "./constants";
import { offlineUrl, offlineUrlById, streamUrl } from "./utils";

function supportsOfflineCache() {
  return !window.esporteFai && "caches" in window;
}

function normalizeOfflineIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((id): id is number => Number.isInteger(id) && id > 0)));
}

export function readOfflineAudioIds(idUser: number) {
  try {
    const scoped = localStorage.getItem(scopedKey(OFFLINE_KEY, idUser));
    return normalizeOfflineIds(JSON.parse(scoped ?? localStorage.getItem(OFFLINE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export function persistOfflineAudioIds(ids: number[], idUser: number) {
  localStorage.setItem(scopedKey(OFFLINE_KEY, idUser), JSON.stringify(normalizeOfflineIds(ids)));
}

function normalizeOfflineRecords(value: unknown) {
  if (!Array.isArray(value)) return [];
  const records = value.filter((item): item is DownloadRecord => Boolean(item && typeof item === "object" && Number.isInteger((item as DownloadRecord).idDownload)));
  const unique = new Map<number, DownloadRecord>();
  for (const record of records) {
    unique.set(record.idDownload, record);
  }
  return Array.from(unique.values());
}

export function readOfflineRecords(idUser: number) {
  try {
    const scoped = localStorage.getItem(scopedKey(OFFLINE_RECORDS_KEY, idUser));
    return normalizeOfflineRecords(JSON.parse(scoped ?? localStorage.getItem(OFFLINE_RECORDS_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

function persistOfflineRecords(records: DownloadRecord[], idUser: number) {
  localStorage.setItem(scopedKey(OFFLINE_RECORDS_KEY, idUser), JSON.stringify(normalizeOfflineRecords(records)));
}

export function mergeOfflineRecords(records: DownloadRecord[], idUser: number) {
  const merged = new Map<number, DownloadRecord>();
  for (const record of records) {
    merged.set(record.idDownload, record);
  }
  for (const record of readOfflineRecords(idUser)) {
    if (!merged.has(record.idDownload)) {
      merged.set(record.idDownload, record);
    }
  }
  return Array.from(merged.values()).sort((a, b) => {
    const left = new Date(a.completedAt || a.createdAt).getTime();
    const right = new Date(b.completedAt || b.createdAt).getTime();
    return right - left;
  });
}

export function upsertOfflineRecord(record: DownloadRecord, idUser: number) {
  persistOfflineRecords(mergeOfflineRecords([record], idUser), idUser);
}

export function removeOfflineRecord(record: DownloadRecord, idUser: number) {
  persistOfflineRecords(
    readOfflineRecords(idUser).filter((item) => item.idDownload !== record.idDownload),
    idUser
  );
}

export async function ensureServiceWorkerReady() {
  if (!("serviceWorker" in navigator) || window.esporteFai) return;
  await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || window.esporteFai) return;
  ensureServiceWorkerReady().catch(() => undefined);
}

export async function verifyOfflineAudioIds(idUser: number, ids = readOfflineAudioIds(idUser)) {
  const normalizedIds = normalizeOfflineIds(ids);
  if (!normalizedIds.length) return [];
  if (!supportsOfflineCache()) return [];

  const cache = await caches.open(MEDIA_CACHE);
  const verified: number[] = [];
  for (const id of normalizedIds) {
    const scopedUrl = offlineUrlById(id, idUser);
    let cached = await cache.match(scopedUrl);
    if (!cached) {
      cached = await cache.match(offlineUrlById(id));
      if (cached) await cache.put(scopedUrl, cached.clone());
    }
    if (cached) {
      verified.push(id);
    }
  }
  return verified;
}

export async function pruneMissingOfflineAudioIds(idUser: number, ids = readOfflineAudioIds(idUser)) {
  const verified = await verifyOfflineAudioIds(idUser, ids);
  persistOfflineAudioIds(verified, idUser);
  const verifiedSet = new Set(verified);
  persistOfflineRecords(
    readOfflineRecords(idUser).filter((record) => verifiedSet.has(record.idDownload)),
    idUser
  );
  localStorage.removeItem(OFFLINE_KEY);
  localStorage.removeItem(OFFLINE_RECORDS_KEY);
  return verified;
}

export async function saveTrackOffline(track: DownloadRecord, idUser: number) {
  if (track.type !== "audio") {
    throw new Error("Offline no celular esta disponivel apenas para audio.");
  }
  if (!supportsOfflineCache()) {
    throw new Error("Este navegador nao oferece cache offline para o PWA.");
  }

  await ensureServiceWorkerReady();
  const response = await fetch(streamUrl(track));
  if (!response.ok) throw new Error("Nao foi possivel baixar a musica para offline.");

  const cache = await caches.open(MEDIA_CACHE);
  await cache.put(offlineUrl(track, idUser), response.clone());
}

export async function removeTrackOffline(track: DownloadRecord, idUser: number) {
  if (!supportsOfflineCache()) return;
  const cache = await caches.open(MEDIA_CACHE);
  await cache.delete(offlineUrl(track, idUser));
  removeOfflineRecord(track, idUser);
}

function scopedKey(baseKey: string, idUser: number) {
  return `${baseKey}:user:${idUser}`;
}
