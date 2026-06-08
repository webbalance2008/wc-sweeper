// Cloudflare Pages Function — proxies API-Football so the API key stays server-side.
// Requests to /api/<endpoint>?<query> are forwarded to
// https://v3.football.api-sports.io/<endpoint>?<query> with the secret key injected.
// Set the key in Cloudflare → Pages project → Settings → Variables and Secrets:
//   Name: API_FOOTBALL_KEY   Type: Secret
const UPSTREAM = "https://v3.football.api-sports.io";

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

  let upstream;
  try {
    upstream = await fetch(target, { headers: { "x-apisports-key": key } });
  } catch (e) {
    return json({ errors: { upstream: String(e) } }, 502);
  }

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/json",
      // brief edge cache to limit upstream calls / quota usage
      "cache-control": "public, max-age=60",
    },
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
