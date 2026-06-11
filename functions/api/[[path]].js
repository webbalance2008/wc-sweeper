// Cloudflare Pages Function — proxies API-Football so the API key stays server-side.
// Requests to /api/<endpoint>?<query> are forwarded to
// https://v3.football.api-sports.io/<endpoint>?<query> with the secret key injected.
// Set the key in Cloudflare → Pages project → Settings → Variables and Secrets:
//   Name: API_FOOTBALL_KEY   Type: Secret
//
// Quota protection: the upstream key is SHARED by every player's browser, so without
// caching, 5 players × every refresh all count against one per-minute / per-day limit.
// We cache successful upstream responses at the Cloudflare edge (Cache API) keyed by the
// request URL, so identical requests from any player are served without touching upstream
// for the TTL window. Errors (429, 5xx, etc.) are never cached.
const UPSTREAM = "https://v3.football.api-sports.io";

// How long to reuse a cached upstream response, by endpoint.
function ttlFor(path) {
  // Events for a finished match never change — cache them hard.
  if (path.startsWith("fixtures/events")) return 3600;     // 1 hour
  // Fixtures/scores update during live play — fresh-ish but still shared across players.
  if (path.startsWith("fixtures")) return 120;             // 2 minutes
  return 120;
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const key = env.API_FOOTBALL_KEY;
  if (!key) {
    return json({ errors: { config: "API_FOOTBALL_KEY secret is not set on this Pages project." } }, 500);
  }

  // Build the upstream path from the catch-all segments + original query string.
  const segs = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const path = segs.map(encodeURIComponent).join("/");
  const search = new URL(request.url).search;
  const target = `${UPSTREAM}/${path}${search}`;

  // Shared edge cache, keyed by the public request URL (same for every player).
  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });

  const hit = await cache.match(cacheKey);
  if (hit) {
    const r = new Response(hit.body, hit);
    r.headers.set("x-proxy-cache", "HIT");
    return r;
  }

  let upstream;
  try {
    upstream = await fetch(target, { headers: { "x-apisports-key": key } });
  } catch (e) {
    return json({ errors: { upstream: String(e) } }, 502);
  }

  const body = await upstream.text();
  const ttl = upstream.ok ? ttlFor(path) : 0;   // only cache successful responses
  const res = new Response(body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/json",
      "cache-control": ttl ? `public, max-age=${ttl}` : "no-store",
      "x-proxy-cache": "MISS",
    },
  });

  if (ttl) context.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
