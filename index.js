const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const pino = require("pino");
const pinoHttp = require("pino-http");

dotenv.config();

const logger = pino({ level: "info" });
const app = express();

app.use(express.json());
app.use(pinoHttp({ logger }));

const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigin === "*" || origin === allowedOrigin) return cb(null, true);
    return cb(new Error("Not allowed by CORS"), false);
  },
}));

app.get("/health", (req, res) => res.json({ ok: true }));

// Googleサジェスト（非公式）→ ラッコリンク付き
app.get("/api/suggest", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.status(400).json({ error: "q is required" });

  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=ja&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) throw new Error(`Suggest HTTP ${r.status}`);
    const json = await r.json(); // ["q", ["候補..."]]
    const suggestions = Array.isArray(json?.[1]) ? json[1] : [];
    res.json({
      q,
      suggestions,
      rakkokeywordLinks: suggestions.map((s) => ({
        keyword: s,
        url: `https://rakkokeyword.com/result/relatedKeywords?q=${encodeURIComponent(s)}`
      })),
    });
  } catch (err) {
    req.log?.error?.({ err }, "Suggest error");
    res.status(500).json({ error: "Suggest error" });
  }
});


const port = process.env.PORT || 10000;
app.listen(port, "0.0.0.0", () => logger.info(`Server listening on :${port}`));
