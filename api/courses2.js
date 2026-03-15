export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { search, state } = req.query;
  if (!search) return res.status(400).json({ error: "search param required" });

  try {
    const apiKey = process.env.RAPIDAPI_KEY;
    if (!apiKey) return res.status(500).json({ error: "RAPIDAPI_KEY not configured" });

    const host = "golf-course-api.p.rapidapi.com";
    const url = `https://${host}/search?name=${encodeURIComponent(search)}${state ? `&state=${encodeURIComponent(state)}` : ""}`;

    const response = await fetch(url, {
      headers: {
        "x-rapidapi-host": host,
        "x-rapidapi-key": apiKey,
      },
    });

    if (response.status === 429) return res.status(429).json({ error: "Rate limit reached" });
    if (!response.ok) return res.status(response.status).json({ error: `API error: ${response.status}` });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error("courses2 error:", err);
    return res.status(500).json({ error: err.message });
  }
}