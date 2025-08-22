const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const pino = require("pino");
const pinoHttp = require("pino-http");
const { AmazonApi } = require("amazon-paapi"); // ← 追記1

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

// === Amazon商品検索API ===  ← 追記2（ここから）
function getAmazonClientOrNull() {
  const { PAAPI_ACCESS_KEY, PAAPI_SECRET_KEY, PAAPI_PARTNER_TAG } = process.env;
  if (!PAAPI_ACCESS_KEY || !PAAPI_SECRET_KEY || !PAAPI_PARTNER_TAG) return null;
  try {
    return new AmazonApi({
      accessKey: PAAPI_ACCESS_KEY,
      secretKey: PAAPI_SECRET_KEY,
      partnerTag: PAAPI_PARTNER_TAG,
      country: "JP",
    });
  } catch {
    return null;
  }
}

// /api/search?keyword=イヤホン&limit=10&index=Electronics
app.get("/api/search", async (req, res) => {
  const keyword = (req.query.keyword || "").toString().trim();
  const limit = Math.min(parseInt(req.query.limit || "10", 10), 30);
  const searchIndex = (req.query.index || "All").toString();

  if (!keyword) return res.status(400).json({ error: "keyword is required" });

  const amazon = getAmazonClientOrNull();
  if (!amazon) {
    return res.status(500).json({ error: "PA-API credentials missing or invalid" });
  }

  try {
    const data = await amazon.searchItems({ keywords: keyword, searchIndex, itemCount: limit });
    const items = (data.items || []).map((item) => ({
      asin: item.asin,
      title: item.title,
      url: item.detailPageUrl,
      image: item.images?.large?.url || item.images?.medium?.url || item.images?.small?.url || null,
      price: item.prices?.price?.displayAmount || null,
      rating: item.reviews?.rating || null,
      totalReviews: item.reviews?.totalReviews || null,
    }));
    res.json({ keyword, searchIndex, count: items.length, items });
  } catch (err) {
    req.log?.error?.({ err }, "PA-API error");
    res.status(500).json({ error: "Amazon API error" });
  }
});
// === 追記2（ここまで）

const port = process.env.PORT || 10000;
app.listen(port, "0.0.0.0", () => logger.info(`Server listening on :${port}`));

app.get("/debug/creds", (req, res) => {
  const mask = (v) => (v ? v.slice(0, 4) + "***" + v.slice(-4) : null);
  res.json({
    accessKeyPresent: !!process.env.PAAPI_ACCESS_KEY,
    secretKeyPresent: !!process.env.PAAPI_SECRET_KEY,
    partnerTag: process.env.PAAPI_PARTNER_TAG || null,
    maskedAccessKey: mask(process.env.PAAPI_ACCESS_KEY || ""),
    maskedSecretKey: mask(process.env.PAAPI_SECRET_KEY || ""),
  });
});

