const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);
const SHORT_YOUTUBE_HOSTS = new Set(["youtu.be", "www.youtu.be"]);
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

export function youtubeVideoId(value: string) {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLocaleLowerCase("en-US");

    if (SHORT_YOUTUBE_HOSTS.has(host)) {
      const id = parsed.pathname.split("/").filter(Boolean)[0] || "";
      return VIDEO_ID_PATTERN.test(id) ? id : null;
    }
    if (!YOUTUBE_HOSTS.has(host)) return null;

    if (parsed.pathname === "/watch") {
      const id = parsed.searchParams.get("v") || "";
      return VIDEO_ID_PATTERN.test(id) ? id : null;
    }

    const [kind, id] = parsed.pathname.split("/").filter(Boolean);
    if (!["shorts", "live", "embed"].includes(kind) || !VIDEO_ID_PATTERN.test(id || "")) {
      return null;
    }
    return id;
  } catch {
    return null;
  }
}

export function isSupportedYoutubeUrl(value: string) {
  return Boolean(youtubeVideoId(value));
}
