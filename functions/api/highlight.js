// Finds the top YouTube highlight video for a match and returns its video ID.
//   GET /api/highlight?q=<search query>  ->  { videoId: "abc123" | null }
//
// The YouTube key stays server-side (Cloudflare secret YOUTUBE_API_KEY).
// Results are cached in the PREDICTIONS KV namespace (key "yt:<query>") so each
// match is only searched once — a YouTube search costs 100 of ~10,000 daily units.
const PREFIX = "yt:";
const TTL = 60 * 60 * 24 * 30; // cache a found video for 30 days

export async function onRequestGet({ request, env }) {
  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (!q) return json({ error: "missing q", videoId: null }, 400);
  if (!env.YOUTUBE_API_KEY) return json({ error: "YOUTUBE_API_KEY not configured", videoId: null });

  const cacheKey = PREFIX + q.toLowerCase();

  // cache hit (empty string = "searched, found nothing")
  if (env.PREDICTIONS) {
    const cached = await env.PREDICTIONS.get(cacheKey);
    if (cached !== null) return json({ videoId: cached || null, cached: true });
  }

  let videoId = null;
  try {
    const api = "https://www.googleapis.com/youtube/v3/search"
      + "?part=snippet&type=video&videoEmbeddable=true&maxResults=1"
      + "&q=" + encodeURIComponent(q)
      + "&key=" + env.YOUTUBE_API_KEY;
    const r = await fetch(api);
    const j = await r.json();
    if (j.error) return json({ error: j.error.message || "youtube error", videoId: null }, 502);
    videoId = (j.items && j.items[0] && j.items[0].id && j.items[0].id.videoId) || null;
  } catch (e) {
    return json({ error: String(e), videoId: null }, 502);
  }

  if (env.PREDICTIONS) {
    await env.PREDICTIONS.put(cacheKey, videoId || "", { expirationTtl: TTL });
  }
  return json({ videoId });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
