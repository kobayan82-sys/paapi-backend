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

const port = process.env.PORT || 10000;
app.listen(port, "0.0.0.0", () => logger.info(`Server listening on :${port}`));
