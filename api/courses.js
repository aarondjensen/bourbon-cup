export default async function handler(req, res) {
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

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}