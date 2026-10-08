// Run: npm init -y && npm i express cors && node server.js   (Node 18+)
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CG = 'https://api.coingecko.com/api/v3';
const WL_FILE = path.join(__dirname, 'watchlist.json');
const cache = new Map();

// ---------- CoinGecko with cache (stale-on-error) ----------
async function cg(p, ttl = 60000) {
  const hit = cache.get(p);
  if (hit && Date.now() - hit.t < ttl) return hit.d;
  try {
    const r = await fetch(CG + p, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('upstream ' + r.status);
    const d = await r.json();
    cache.set(p, { t: Date.now(), d });
    return d;
  } catch (e) {
    if (hit) return hit.d; // serve stale data
    throw e;
  }
}

// ---------- Mock data (used when CoinGecko is unreachable / rate-limited) ----------
const SEED = [
  ['bitcoin', 'btc', 'Bitcoin', 65000, 19.7e6, 21e6],
  ['ethereum', 'eth', 'Ethereum', 3200, 120e6, null],
  ['tether', 'usdt', 'Tether', 1, 110e9, null],
  ['binancecoin', 'bnb', 'BNB', 580, 150e6, 200e6],
  ['solana', 'sol', 'Solana', 150, 450e6, null],
  ['ripple', 'xrp', 'XRP', 0.52, 55e9, 100e9],
  ['dogecoin', 'doge', 'Dogecoin', 0.12, 145e9, null],
  ['cardano', 'ada', 'Cardano', 0.45, 36e9, 45e9],
];
function walk(end, n) {
  const a = [];
  let p = end;
  for (let i = 0; i < n; i++) { a.unshift(p); p *= 1 + (Math.random() - 0.5) * 0.02; }
  return a;
}
function mockCoins() {
  return SEED.map(([id, symbol, name, p0, circ, max], i) => {
    const price = p0 * (1 + (Math.random() - 0.5) * 0.02);
    return {
      id, symbol, name, image: '',
      current_price: price,
      market_cap: price * circ,
      market_cap_rank: i + 1,
      total_volume: price * circ * 0.03,
      circulating_supply: circ,
      total_supply: max || circ,
      max_supply: max,
      price_change_percentage_24h: (Math.random() - 0.5) * 10,
      high_24h: price * 1.03,
      low_24h: price * 0.97,
      ath: price * 1.8,
      sparkline_in_7d: { price: walk(price, 168) },
    };
  });
}
function mockChart(id, days) {
  const base = (SEED.find((s) => s[0] === id) || [0, 0, 0, 100])[3];
  const n = days <= 1 ? 96 : Math.min(days * 12, 400);
  const span = days * 86400000;
  const now = Date.now();
  return { prices: walk(base, n).map((p, i) => [now - span + (span * i) / (n - 1), p]) };
}
const mockGlobal = () => ({
  data: {
    active_cryptocurrencies: 14000,
    total_market_cap: { usd: 2.4e12 },
    total_volume: { usd: 9.1e10 },
    market_cap_percentage: { btc: 52.3, eth: 17.1 },
    market_cap_change_percentage_24h_usd: (Math.random() - 0.5) * 4,
  },
});

const MARKETS =
  '/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=24h';

async function getCoins() {
  try { return { data: await cg(MARKETS, 60000), source: 'live' }; }
  catch { return { data: mockCoins(), source: 'mock' }; }
}

// ---------- Routes ----------
app.get('/api/health', (_, res) => res.json({ ok: true }));

app.get('/api/coins', async (_, res) => {
  const { data, source } = await getCoins();
  res.set('X-Data-Source', source).json(data);
});

app.get('/api/coins/:id', async (req, res) => {
  const { data } = await getCoins();
  const c = data.find((x) => x.id === req.params.id);
  c ? res.json(c) : res.status(404).json({ error: 'Coin not found' });
});

app.get('/api/coins/:id/chart', async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 365);
  const id = encodeURIComponent(req.params.id);
  try {
    const d = await cg(`/coins/${id}/market_chart?vs_currency=usd&days=${days}`, 120000);
    res.json(d);
  } catch {
    res.json(mockChart(req.params.id, days));
  }
});

app.get('/api/global', async (_, res) => {
  try { res.json(await cg('/global', 120000)); }
  catch { res.json(mockGlobal()); }
});

// ---------- Watchlist (persisted to JSON file) ----------
const readWL = () => { try { return JSON.parse(fs.readFileSync(WL_FILE, 'utf8')); } catch { return []; } };
const writeWL = (l) => fs.writeFileSync(WL_FILE, JSON.stringify(l));

app.get('/api/watchlist', (_, res) => res.json(readWL()));
app.post('/api/watchlist/:id', (req, res) => {
  const l = readWL();
  if (!l.includes(req.params.id)) l.push(req.params.id);
  writeWL(l);
  res.json(l);
});
app.delete('/api/watchlist/:id', (req, res) => {
  const l = readWL().filter((x) => x !== req.params.id);
  writeWL(l);
  res.json(l);
});

app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
