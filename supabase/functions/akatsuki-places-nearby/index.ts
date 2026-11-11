// akatsuki-places-nearby — the hub's Google Places lookup.  R018 G3 · Oct 5
// Deploy:  supabase functions deploy akatsuki-places-nearby --no-verify-jwt   (the caller's user JWT is checked in code: auth.getUser)
// Secret:  GOOGLE_PLACES_API_KEY (already set for Cost's places-nearby — same project, same secret)
//
// Differences from Cost's places-nearby (B8): the caller's JWT is verified and every DB call runs AS THAT USER
// (RLS), the monthly cap is taken server-side (akatsuki_places_budget_take), results cache in akatsuki_cache
// with a 30-day TTL (7 days when empty), and places.id is in the field mask.
import { createClient } from 'npm:@supabase/supabase-js@2';

// CORS: '*' — the bearer JWT is the gate, not the origin (R018 A2 fix: preflight was rejected; x-client-info was missing).
const cors = (_origin: string | null) => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-akatsuki-app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
});
const json = (origin: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors(origin) });
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
const dist = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

// ── R042 · explore mode (Setu): what's worth going to around a destination.  Same key, same JWT rule, SAME monthly cap.
// Own cache (source places_explore) so it never mixes with the shop finder's.  Field mask = the shop finder's + primaryType
// (no rating/hours: those bill at a higher tier).
const EXPLORE_TYPES = ['restaurant', 'cafe', 'tourist_attraction'];
async function explore(sb: any, uid: string, origin: string | null, req: Request, q: { lat: number; lng: number }, body: any, force: boolean, KEY: string) {
  const types = [...new Set<string>((Array.isArray(body.types) ? body.types : ['restaurant', 'tourist_attraction']).filter((t: string) => EXPLORE_TYPES.includes(t)))].sort();
  if (!types.length) return json(origin, { status: 'error', code: 'AK102', reason: `types must be some of ${EXPLORE_TYPES.join(', ')}` }, 400);
  const radius = Math.min(2000, Math.max(200, Math.round(Number(body.radius_m) || 1000)));
  const r3 = (n: number) => Math.round(n * 1e3) / 1e3;   // ~110 m grid: a re-search near the same spot is a cache hit
  const key = `x:${types.join('+')}:${radius}:${r3(q.lat)},${r3(q.lng)}`;

  if (!force) {
    const { data: hit } = await sb.from('akatsuki_cache').select('payload,expires_at').eq('source', 'places_explore').eq('key', key).maybeSingle();
    if (hit && (!hit.expires_at || hit.expires_at > new Date().toISOString()))
      return json(origin, { status: hit.payload.candidates?.length ? 'hit' : 'empty', cached: true, ...hit.payload });
  }
  const { data: calls, error: bErr } = await sb.rpc('akatsuki_places_budget_take');
  if (bErr) {
    const capped = bErr.code === 'AK210' || /AK210/.test(bErr.message);
    return json(origin, { status: capped ? 'capped' : 'error', code: bErr.code, reason: bErr.message }, capped ? 429 : 500);
  }
  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY,
               'X-Goog-FieldMask': 'places.id,places.displayName,places.types,places.primaryType,places.location' },
    body: JSON.stringify({ includedTypes: types, maxResultCount: 20, rankPreference: 'POPULARITY',
                           locationRestriction: { circle: { center: { latitude: q.lat, longitude: q.lng }, radius } } }),
  });
  if (!res.ok) return json(origin, { status: 'error', reason: `places HTTP ${res.status}`, detail: (await res.text()).slice(0, 200) }, 502);
  const data = await res.json();
  const candidates = (data.places || []).filter((p: any) => p.displayName?.text).map((p: any, i: number) => ({
    place_id: p.id, name: p.displayName.text, primary_type: p.primaryType || null, types: p.types || [],
    lat: p.location?.latitude, lng: p.location?.longitude, rank: i + 1,
    distance_m: p.location ? Math.round(dist(q, { lat: p.location.latitude, lng: p.location.longitude })) : null,
  }));
  const payload = { q, types, radius_m: radius, candidates, fetched_by: req.headers.get('x-akatsuki-app') || 'unknown', source: 'Google Places (New) searchNearby' };
  await sb.from('akatsuki_cache').upsert({
    user_id: uid, source: 'places_explore', key, payload,
    fetched_at: new Date().toISOString(), expires_at: new Date(Date.now() + (candidates.length ? 30 : 7) * 864e5).toISOString(),
  }, { onConflict: 'user_id,source,key' });
  return json(origin, { status: candidates.length ? 'fetched' : 'empty', cached: false, calls, ...payload });
}

// Keys (2026-10-28 key migration): the new publishable key, falling back to the legacy anon key.  Either way the
// DB calls run as the forwarded user JWT; a request with no signed-in user stops at getUser below.
const PUBLIC_KEY = (() => { try { return JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}').default; } catch { return null; } })() || Deno.env.get('SUPABASE_ANON_KEY')!;

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors(origin) });
  const KEY = Deno.env.get('GOOGLE_PLACES_API_KEY');
  if (!KEY) return json(origin, { status: 'error', reason: 'missing secret GOOGLE_PLACES_API_KEY' }, 500);

  // The user's JWT, forwarded.  Every query below is RLS-scoped to them; the bare anon key gets 401 from the RPC.
  // Header key MUST be 'Authorization' (capitalised): supabase-js merges global.headers by key, and a lowercase
  // 'authorization' sits next to its default 'Authorization: Bearer <anon>' — two headers, auth.uid() null.
  const auth = req.headers.get('Authorization') || req.headers.get('authorization') || '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, PUBLIC_KEY, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user } } = await sb.auth.getUser(jwt);
  if (!user) return json(origin, { status: 'error', reason: 'not signed in' }, 401);

  let body: any; try { body = await req.json(); } catch { return json(origin, { status: 'error', code: 'AK102', reason: 'body must be JSON {lat,lng,force?}' }, 400); }
  const lat = Number(body?.lat), lng = Number(body?.lng), force = !!body?.force;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return json(origin, { status: 'error', code: 'AK102', reason: 'lat and lng are required numbers' }, 400);
  const q = { lat, lng };
  if (body?.mode === 'explore') return explore(sb, user.id, origin, req, q, body, force, KEY);

  // 1 · cache-first: nearest corner within 100 m
  if (!force) {
    const { data: hit } = await sb.rpc('akatsuki_places_cache_get', { p_lat: lat, p_lng: lng });
    if (hit) return json(origin, { status: hit.candidates?.length ? 'hit' : 'empty', cached: true, q: hit.q, candidates: hit.candidates ?? [] });
  }

  // 2 · take one unit of budget — AK210 when the month's cap is spent
  const { data: calls, error: bErr } = await sb.rpc('akatsuki_places_budget_take');
  if (bErr) {
    const capped = bErr.code === 'AK210' || /AK210/.test(bErr.message);
    return json(origin, { status: capped ? 'capped' : 'error', code: bErr.code, reason: bErr.message }, capped ? 429 : 500);
  }

  // 3 · Google — same request shape as Cost's, plus places.id
  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY,
               'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.types,places.location' },
    body: JSON.stringify({ maxResultCount: 10, rankPreference: 'DISTANCE', locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 150 } } }),
  });
  if (!res.ok) return json(origin, { status: 'error', reason: `places HTTP ${res.status}`, detail: (await res.text()).slice(0, 200) }, 502);
  const data = await res.json();
  const candidates = (data.places || [])
    .filter((p: any) => p.displayName?.text)
    .map((p: any) => ({
      place_id: p.id, name: p.displayName.text, address: p.formattedAddress || null, types: p.types || [],
      lat: p.location?.latitude, lng: p.location?.longitude,
      distance_m: p.location ? Math.round(dist(q, { lat: p.location.latitude, lng: p.location.longitude })) : null,
    }))
    .sort((a: any, b: any) => (a.distance_m ?? 1e9) - (b.distance_m ?? 1e9))
    .slice(0, 5);

  // 4 · cache (empty answers too, shorter TTL) — key = 4-dp grid; lookup is by distance, not key
  const ttlDays = candidates.length ? 30 : 7;
  await sb.from('akatsuki_cache').upsert({
    user_id: user.id, source: 'places_nearby', key: `g:${round4(lat)},${round4(lng)}`,
    payload: { q, candidates, fetched_by: req.headers.get('x-akatsuki-app') || 'unknown' },
    fetched_at: new Date().toISOString(), expires_at: new Date(Date.now() + ttlDays * 864e5).toISOString(),
  }, { onConflict: 'user_id,source,key' });

  return json(origin, { status: candidates.length ? 'fetched' : 'empty', cached: false, calls, q, candidates });
});
