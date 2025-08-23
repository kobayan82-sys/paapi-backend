// index.js — Rakuten API backend (Express / CommonJS)

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const pino = require("pino");
const pinoHttp = require("pino-http");

dotenv.config();

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const app = express();

app.use(express.json());
app.use(pinoHttp({ logger }));

const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigin === "*" || origin === allowedOrigin) return cb(null, true);
      return cb(new Error("Not allowed by CORS"), false);
    },
  })
);

app.get("/health", (req, res) => res.json({ ok: true }));

function buildRakutenSearchUrl({ keyword, hits = 10, page = 1, genreId, sort, minPrice, maxPrice }) {
  const base = "https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706";
  const u = new URL(base);
  const appId = process.env.RAKUTEN_APP_ID;
  if (!appId) throw new Error("RAKUTEN_APP_ID is missing in env");

  u.searchParams.set("applicationId", appId);
  if (process.env.RAKUTEN_AFFILIATE_ID) u.searchParams.set("affiliateId", process.env.RAKUTEN_AFFILIATE_ID);

  if (keyword) u.searchParams.set("keyword", keyword);
  if (genreId) u.searchParams.set("genreId", String(genreId));

  if (sort) u.searchParams.set("sort", String(sort));
  if (minPrice) u.searchParams.set("minPrice", String(minPrice));
  if (maxPrice) u.searchParams.set("maxPrice", String(maxPrice));

  const safeHits = Math.min(Math.max(parseInt(hits || "10", 10), 1), 30);
  const safePage = Math.max(parseInt(page || "1", 10), 1);
  u.searchParams.set("hits", String(safeHits));
  u.searchParams.set("page", String(safePage));
  u.searchParams.set("format", "json");
  u.searchParams.set("imageFlag", "1");
  return u.toString();
}

async function safeFetchJson(url, { timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Render-Node/Express)" },
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`HTTP ${r.status} ${r.statusText} - ${text.slice(0, 200)}`);
    }
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

app.get("/api/search", async (req, res) => {
  const keyword = (req.query.keyword || "").toString().trim();
  const hits = parseInt(req.query.hits || "10", 10);
  const page = parseInt(req.query.page || "1", 10);
  const genreId = req.query.genreId ? String(req.query.genreId).trim() : undefined;

  if (!keyword && !genreId) {
    return res.status(400).json({ error: "Either keyword or genreId is required" });
  }
  if (!process.env.RAKUTEN_APP_ID) {
    return res.status(500).json({ error: "RAKUTEN_APP_ID is missing in env" });
  }

  try {
    const url = buildRakutenSearchUrl({ keyword, hits, page, genreId });
    req.log.info({ url }, "Rakuten search URL");
    const json = await safeFetchJson(url);

    const itemsRaw = Array.isArray(json?.Items) ? json.Items : [];
    const items = itemsRaw.map((wrp) => {
      const it = wrp.Item || {};
      const img =
        (Array.isArray(it.mediumImageUrls) && it.mediumImageUrls[0]?.imageUrl) ||
        (Array.isArray(it.smallImageUrls) && it.smallImageUrls[0]?.imageUrl) ||
        null;
      return {
        name: it.itemName || "",
        url: it.itemUrl || "",
        image: img,
        price: typeof it.itemPrice === "number" ? it.itemPrice : null,
        shop: it.shopName || "",
        affiliateUrl: it.affiliateUrl || null,
        genreId: it.genreId || null,
        reviewAverage: typeof it.reviewAverage === "number" ? it.reviewAverage : (it.reviewAverage ? Number(it.reviewAverage) : null),
        reviewCount: typeof it.reviewCount === "number" ? it.reviewCount : (it.reviewCount ? Number(it.reviewCount) : null),
      };
    });

    res.json({
      count: items.length,
      page: Number.isFinite(page) ? page : 1,
      hits: Number.isFinite(hits) ? hits : 10,
      keyword: keyword || null,
      genreId: genreId || null,
      items,
    });
  } catch (err) {
    req.log.error({ err }, "Rakuten search error");
    res.status(500).json({ error: "Rakuten search error" });
  }
});

app.get("/api/suggest", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.status(400).json({ error: "q is required" });

  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=ja&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Render-Node/Express)" } });
    if (!r.ok) throw new Error(`Suggest HTTP ${r.status}`);
    const json = await r.json();
    const suggestions = Array.isArray(json?.[1]) ? json[1] : [];

    res.json({
      q,
      suggestions,
      rakkokeywordLinks: suggestions.map((s) => ({
        keyword: s,
        url: `https://rakkokeyword.com/result/relatedKeywords?q=${encodeURIComponent(s)}`,
      })),
    });
  } catch (err) {
    req.log?.error?.({ err }, "Suggest error");
    res.status(500).json({ error: "Suggest error" });
  }
});

const port = process.env.PORT || 10000;
app.listen(port, "0.0.0.0", () => logger.info(`Server listening on :${port}`));
