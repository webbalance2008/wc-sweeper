// Cloudflare Pages Function — proxies API-Football so the API key stays server-side.
// Requests to /api/<endpoint>?<query> are forwarded to
// https://v3.football.api-sports.io/<endpoint>?<query> with the secret key injected.
// Set the key in Cloudflare → Pages project → Settings → Variables and Secrets:
//   Name: API_FOOTBALL_KEY   Type: Secret
//
// Quota protection: the upstream key is SHARED by every player's browser. The Pro plan's
// per-DAY budget is generous, but the per-MINUTE limit is hit in bursts at peak (everyone
// opening the page around kickoff). Two layers guard against that:
//   1. Fresh cache — successful responses are cached at the edge (Cache API) keyed by URL,
//      so identical requests from any player are served without touching upstream for the TTL.
//   2. Serve-stale-on-error — every success is ALSO kept as a long-lived "last known good"
//      copy. If upstream is rate-limited (or 5xx) and we have a prior good copy, we serve
//      that stale copy instead of an error, so players see slightly-old scores, never a red
//      error. Error responses are NEVER cached (no poisoning a 200-with-errors body).
//
// IMPORTANT: api-sports returns rate-limit errors as HTTP 200 with {"errors":{"rateLimit":..}},
// not a 429 — so we must inspect the body, not just the status code.
const UPSTREAM = "https://v3.football.api-sports.io";

// How long to reuse a cached upstream response, by endpoint.
function ttlFor(path) {
  if (path.startsWith("fixtures/events")) return 3600;     // events of a finished match never change
  if (path.startsWith("fixtures")) return 120;             // scores update during live play
  return 120;
}
const STALE_TTL = 86400;   // 1 day: how long a "last known good" copy is kept for fallback

// Does a parsed api-sports body carry a non-empty errors payload?
function bodyError(body) {
  try {
    const j = JSON.parse(body);
    const e = j && j.errors;
    const has = e && (Array.isArray(e) ? e.length : Object.keys(e).length);
    if (!has) return null;
    const txt = JSON.stringify(e).toLowerCase();
    const rateLimited = !!e.rateLimit || txt.includes("too many request") || txt.includes("ratelimit");
    return { rateLimited };
  } catch (_) {
    return null;   // non-JSON 2xx (unlikely) — treat as a normal success
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const key = env.API_FOOTBALL_KEY;
  if (!key) {
    return json({ errors: { config: "API_FOOTBALL_KEY secret is not set on this Pages project." } }, 500);
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "");   // strip the /api/ prefix
  const target = `${UPSTREAM}/${path}${url.search}`;

  const cache = caches.default;
  const freshKey = new Request(url.toString());
  // Stale ("last known good") key ignores the client's per-minute cache-buster (_m) used for
  // live matches — so every successful minute refreshes ONE shared stale copy, and a later
  // rate-limited minute falls back to it (slightly-old events) instead of erroring out.
  const staleUrl = new URL(url.toString());
  staleUrl.searchParams.delete("_m");
  staleUrl.searchParams.set("__tier", "stale");          // distinct key for the long-lived copy
  const staleKey = new Request(staleUrl.toString());

  // 1) Fresh edge-cache hit — serve immediately, no upstream call.
  const fresh = await cache.match(freshKey);
  if (fresh) return withHeader(fresh, "x-proxy-cache", "HIT");

  // 2) Go upstream.
  let upstreamStatus = 502, body = "", ok = false, rateLimited = false;
  try {
    const upstream = await fetch(target, { headers: { "x-apisports-key": key } });
    upstreamStatus = upstream.status;
    body = await upstream.text();
    ok = upstream.ok;
    if (ok) {
      const err = bodyError(body);   // a 200 may still carry an errors payload
      if (err) { ok = false; rateLimited = err.rateLimited; }
    }
  } catch (e) {
    body = JSON.stringify({ errors: { upstream: String(e) } });
  }

  // 3) Success — cache fresh + refresh the long-lived stale copy, then serve.
  if (ok) {
    const ttl = ttlFor(path);
    const res = new Response(body, {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttl}`, "x-proxy-cache": "MISS" },
    });
    context.waitUntil(cache.put(freshKey, res.clone()));
    context.waitUntil(cache.put(staleKey, new Response(body, {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": `public, max-age=${STALE_TTL}` },
    })));
    return res;
  }

  // 4) Upstream errored — serve last-known-good if we have one (never show a red error during a spike).
  const stale = await cache.match(staleKey);
  if (stale) {
    const r = withHeader(stale, "x-proxy-cache", "STALE");
    r.headers.set("cache-control", "no-store");
    if (rateLimited) r.headers.set("x-ratelimit-hit", "1");   // flag it so the client can log it
    return r;
  }

  // 5) No stale copy — pass the error through, NEVER cached. 429 + Retry-After so clients back off.
  return new Response(body || "{}", {
    status: rateLimited ? 429 : upstreamStatus,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-proxy-cache": "MISS",
      ...(rateLimited ? { "retry-after": "30", "x-ratelimit-hit": "1" } : {}),
    },
  });
}

function withHeader(resp, name, value) {
  const r = new Response(resp.body, resp);
  r.headers.set(name, value);
  return r;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
