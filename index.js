// ==== 必要モジュール ====
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const pino = require("pino");
const pinoHttp = require("pino-http");

// Node 20+/22+ は fetch がグローバルで使用可
dotenv.config();

const logger = pino({ level: "info" });
const app = express();

app.use(express.json());
app.use(pinoHttp({ logger }));

// ==== CORS ====
const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigin === "*" || origin === allowedOrigin) return cb(null, true);
      return cb(new Error("Not allowed by CORS"), false);
    },
  })
);

// ==== Health ====
app.get("/health", (req, res) => res.json({ ok: true }));

// ==== Googleサジェスト（非公式）→ ラッコリンク付き ====
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
        url: `https://rakkokeyword.com/result/relatedKeywords?q=${encodeURIComponent(s)}`,
      })),
    });
  } catch (err) {
    req.log?.error?.({ err }, "Suggest error");
    res.status(500).json({ error: "Suggest error" });
  }
});

// ==== 楽天 商品検索API ====
// 参考: https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706
// 必須: process.env.RAKUTEN_APP_ID
// 任意: process.env.RAKUTEN_AFFILIATE_ID

// 許可する sort 一覧
const ALLOWED_SORT = new Set([
  "+itemPrice", "-itemPrice",
  "+reviewCount", "-reviewCount",
  "+reviewAverage", "-reviewAverage",
]);

function buildRakutenSearchUrl({ keyword, hits = 10, page = 1, sort = "" }) {
  const base = "https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706";
  const u = new URL(base);
  u.searchParams.set("applicationId", process.env.RAKUTEN_APP_ID);
  if (process.env.RAKUTEN_AFFILIATE_ID) {
    u.searchParams.set("affiliateId", process.env.RAKUTEN_AFFILIATE_ID);
  }
  if (keyword) u.searchParams.set("keyword", keyword);
  if (genreId) u.searchParams.set("genreId", String(genreId));
  u.searchParams.set("hits", String(Math.min(Math.max(hits, 1), 30))); // 1〜30
  u.searchParams.set("page", String(Math.max(page, 1)));
  u.searchParams.set("format", "json");
  u.searchParams.set("imageFlag", "1"); // 画像あり
  if (sort && ALLOWED_SORT.has(sort)) {
    u.searchParams.set("sort", sort);
  }
  return u.toString();
}

// /api/search?keyword=イヤホン&hits=10&page=1&sort=+itemPrice
app.get("/api/search", async (req, res) => {
  const keyword = (req.query.keyword || "").toString().trim();
  const hits = parseInt(req.query.hits || "10", 10);
  const page = parseInt(req.query.page || "1", 10);
  const genreId = req.query.genreId ? String(req.query.genreId).trim() : undefined;
  const sort = (req.query.sort || "").toString();

  if (!keyword && !genreId) {
    return res.status(400).json({ error: "Either keyword or genreId is required" });
    }
  if (!process.env.RAKUTEN_APP_ID) {
    return res.status(500).json({ error: "RAKUTEN_APP_ID is missing in env" });
  }

  try {
    const url = buildRakutenSearchUrl({ keyword, hits, page, genreId });
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Rakuten HTTP ${r.status}: ${text.slice(0, 200)}`);
    }
    const data = await r.json();

    // data.Items は [{ Item: {...} }, ...] の配列
    const items = (data.Items || []).map(({ Item }) => ({
      id: Item.itemCode,           // ショップコード:商品コード
      name: Item.itemName,         // 元タイトル（フロント側で整形）
      url: Item.itemUrl,           // affiliateId 指定時はアフィリエイトURL
      price: Item.itemPrice,
      shop: Item.shopName,
      image:
        Item.mediumImageUrls?.[0]?.imageUrl ||
        Item.smallImageUrls?.[0]?.imageUrl ||
        null,
      reviewAverage: Item.reviewAverage,
      reviewCount: Item.reviewCount,
      catchcopy: Item.catchcopy || null,
      genreId: Item.genreId || null,
      taxFlag: Item.taxFlag,       // 0:税込/1:税別
      postageFlag: Item.postageFlag // 0:送料別/1:送料込
    }));

    res.json({
      keyword,
      page: Number(data.page) || page,
      hits: Number(data.hits) || hits,
      count: items.length,
      items,
    });
  } catch (err) {
    req.log?.error?.({ err: { message: err.message } }, "Rakuten API error");
    res.status(502).json({ error: "Rakuten API error", detail: err.message });
  }
});

// ==== Listen ====
const port = process.env.PORT || 10000;
app.listen(port, "0.0.0.0", () => logger.info(`Server listening on :${port}`));
