// Shared tiebreaker predictions, stored in Cloudflare KV (binding: PREDICTIONS).
//   GET  /api/predictions            -> { predictions: { <player>: {goals,og,yel,red} } }
//   POST /api/predictions {player, values} -> saves one player's card (rejected once locked)
//
// LOCK: predictions freeze once the first World Cup match has kicked off. The kickoff
// time is read from the football API (earliest fixture) so it can't be bypassed client-side.
//
// Requires two bindings on the Pages project:
//   - KV namespace binding named  PREDICTIONS
//   - Secret named                API_FOOTBALL_KEY
const UPSTREAM = "https://v3.football.api-sports.io";
const STORE_KEY = "data";

export async function onRequestGet({ env }) {
  if (!env.PREDICTIONS) return json({ error: "KV binding 'PREDICTIONS' is not configured." }, 500);
  const predictions = (await env.PREDICTIONS.get(STORE_KEY, "json")) || {};
  return json({ predictions });
}

export async function onRequestPost({ request, env }) {
  if (!env.PREDICTIONS) return json({ error: "KV binding 'PREDICTIONS' is not configured." }, 500);

  if (await tournamentStarted(env)) {
    return json({ error: "locked", message: "Predictions are locked — the tournament has started." }, 403);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const player = body && body.player;
  const values = body && body.values;
  if (!player || typeof values !== "object" || values === null) {
    return json({ error: "expected { player, values }" }, 400);
  }

  const clean = {};
  for (const k of ["goals", "og", "yel", "red"]) {
    if (values[k] !== undefined && values[k] !== null && values[k] !== "") {
      const n = Number(values[k]);
      if (Number.isFinite(n) && n >= 0) clean[k] = n;
    }
  }

  const data = (await env.PREDICTIONS.get(STORE_KEY, "json")) || {};
  data[player] = clean;
  await env.PREDICTIONS.put(STORE_KEY, JSON.stringify(data));
  return json({ predictions: data });
}

async function tournamentStarted(env) {
  try {
    const r = await fetch(`${UPSTREAM}/fixtures?league=1&season=2026`, {
      headers: { "x-apisports-key": env.API_FOOTBALL_KEY || "" },
    });
    const j = await r.json();
    const dates = (j.response || []).map(f => f.fixture && f.fixture.date).filter(Boolean).sort();
    if (!dates.length) return false;            // no fixtures yet -> stay open
    return Date.now() >= Date.parse(dates[0]);  // first kickoff reached -> locked
  } catch {
    return false; // if the check fails, don't lock people out
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
