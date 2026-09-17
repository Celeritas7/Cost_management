const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const fail = (reason: string) => json({ error: true, reason });

const distanceM = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000, toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const key = Deno.env.get("GOOGLE_PLACES_API_KEY");
    if (!key) return fail("GOOGLE_PLACES_API_KEY not configured");
    const { lat, lng } = await req.json();
    if (typeof lat !== "number" || typeof lng !== "number") return fail("lat and lng required");

    const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.displayName,places.types,places.location",
      },
      body: JSON.stringify({
        maxResultCount: 10,
        rankPreference: "DISTANCE",
        locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 150.0 } },
      }),
    });
    if (!res.ok) return fail(`places HTTP ${res.status}`);
    const data = await res.json();
    const places = (data.places ?? [])
      .map((p: { displayName?: { text?: string }; types?: string[]; location?: { latitude: number; longitude: number } }) => ({
        name: p.displayName?.text ?? "",
        place_types: p.types ?? [],
        distance_m: p.location ? distanceM({ lat, lng }, { lat: p.location.latitude, lng: p.location.longitude }) : null,
      }))
      .filter((p: { name: string }) => p.name)
      .sort((a: { distance_m: number }, b: { distance_m: number }) => (a.distance_m ?? 9e9) - (b.distance_m ?? 9e9))
      .slice(0, 5);
    return json({ candidates: places });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "places lookup failed");
  }
});
