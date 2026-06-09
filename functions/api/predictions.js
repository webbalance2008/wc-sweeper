// Shared tiebreaker predictions, stored in Cloudflare KV (binding: PREDICTIONS).
//   GET  /api/predictions            -> { predictions: { <player>: {goals,og,yel,red} } }
//   POST /api/predictions {player, values} -> saves one player's card (rejected once locked)
//
// LOCK: predictions freeze at kickoff of the tournament (GO_LIVE). Using a fixed date means
// no football API call is needed to check the lock — so nothing is fetched before the World Cup.
// Keep GO_LIVE in sync with the same constant in index.html.
//
// Requires one binding on the Pages project:
//   - KV namespace binding named  PREDICTIONS
const GO_LIVE = Date.parse("2026-06-11T00:00:00Z");
const STORE_KEY = "data";

export async function onRequestGet({ env }) {
  if (!env.PREDICTIONS) return json({ error: "KV binding 'PREDICTIONS' is not configured." }, 500);
  const predictions = (await env.PREDICTIONS.get(STORE_KEY, "json")) || {};
  return json({ predictions });
}

export async function onRequestPost({ request, env }) {
  if (!env.PREDICTIONS) return json({ error: "KV binding 'PREDICTIONS' is not configured." }, 500);

  if (Date.now() >= GO_LIVE) {
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

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
