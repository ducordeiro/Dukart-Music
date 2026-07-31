import type { AppDatabase } from "./database";
import type { YoutubeSearchResult } from "../shared/types";

const YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
export const YOUTUBE_SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const YOUTUBE_SEARCH_MAX_RESULTS = 10;

interface YoutubeApiSearchItem {
  id?: {
    videoId?: string;
  };
  snippet?: {
    title?: string;
    channelTitle?: string;
    thumbnails?: {
      default?: { url?: string };
      medium?: { url?: string };
      high?: { url?: string };
    };
  };
}

interface YoutubeApiSearchResponse {
  items?: YoutubeApiSearchItem[];
  error?: {
    message?: string;
  };
}

export function normalizeYoutubeSearchQuery(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function searchYoutubeMusic(database: AppDatabase, rawQuery: string) {
  const query = normalizeYoutubeSearchQuery(rawQuery);
  if (!query) {
    throw new Error("Digite o nome da musica.");
  }

  const cached = database.getYoutubeSearchCache(query, YOUTUBE_SEARCH_CACHE_TTL_MS);
  if (cached) {
    return cached;
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY nao configurada no backend.");
  }

  const params = new URLSearchParams({
    part: "snippet",
    q: query,
    type: "video",
    maxResults: String(YOUTUBE_SEARCH_MAX_RESULTS),
    key: apiKey
  });

  const response = await fetch(`${YOUTUBE_SEARCH_URL}?${params.toString()}`);
  const payload = (await response.json().catch(() => ({}))) as YoutubeApiSearchResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message || "Falha ao consultar a YouTube Data API.");
  }

  const results = (payload.items || [])
    .map<YoutubeSearchResult | null>((item) => {
      const videoId = item.id?.videoId;
      if (!videoId) return null;

      return {
        videoId,
        titulo: item.snippet?.title || "Video sem titulo",
        canal: item.snippet?.channelTitle || "",
        thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.default?.url || ""
      };
    })
    .filter((item): item is YoutubeSearchResult => Boolean(item));

  database.saveYoutubeSearchCache(query, results);
  return results;
}
