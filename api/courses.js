export default async function handler(req, res) {
  // Set before anything can return, which courses2.js already did and this
  // did not: the header used to be written on the success path only, so a
  // 400 or a 500 came back without it and the browser refused to let the
  // caller read the reason. From the app that is indistinguishable from the
  // network being down.
  //
  // It matters more now than it did. On the web this is a same-origin call
  // and CORS never enters into it; the iOS build fetches this from
  // `capacitor://localhost` cross-origin, so every response needs the header
  // — including the ones that are explaining a failure.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { search } = req.query;
  if (!search) return res.status(400).json({ error: "Missing search param" });

  try {
    const apiKey = process.env.GOLF_COURSE_API_KEY;
    const url = `https://api.golfcourseapi.com/v1/search?search_query=${encodeURIComponent(search)}`;
    const response = await fetch(url, {
      headers: {
        "Authorization": `Key ${apiKey}`,
      },
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json();

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}