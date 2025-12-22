/**
 * Vercel Serverless Function
 * Route example: /api/presale
 *
 * REQUIRED ENV:
 *  - ETHERSCAN_API_KEY
 *
 * This function:
 *  - Fetches logs from Etherscan
 *  - Parses wallet, USD amount, lock months
 *  - Returns live analytics JSON
 */

import fs from "fs";
import path from "path";

// =====================
// Vercel runtime safety: cache + retry
// =====================
let __CACHE = { at: 0, ttlMs: 25_000, data: null };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fetchJsonWithRetry = async (url, { tries = 4, timeoutMs = 10_000 } = {}) => {
  let lastErr = null;

  for (let i = 0; i < tries; i++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });

      const json = await res.json().catch(() => null);

      // Etherscan sometimes returns status 0 with busy/timeout message
      const isEtherscanBusy =
        json &&
        json.status === "0" &&
        typeof json.message === "string" &&
        json.message.toLowerCase().includes("timeout");

      if (!res.ok || isEtherscanBusy) {
        const msg = json ? JSON.stringify(json) : `HTTP ${res.status}`;
        throw new Error(msg);
      }

      return json;
    } catch (e) {
      lastErr = e;
      // exponential backoff with jitter
      const backoff = Math.min(1200 * Math.pow(2, i), 6500) + Math.floor(Math.random() * 250);
      await sleep(backoff);
    } finally {
      clearTimeout(t);
    }
  }

  throw lastErr || new Error("fetchJsonWithRetry failed");
};

// Load our wallets (data_check.txt)
const OUR_WALLETS = new Set(
  fs
    .readFileSync(path.join(process.cwd(), "data_check.txt"), "utf-8")
    .split("\n")
    .map(w => w.trim().toLowerCase())
    .filter(Boolean)
);

export default async function handler(req, res) {
  try {
    // Serve cache if fresh to avoid Etherscan stampede
    if (__CACHE.data && (Date.now() - __CACHE.at) < __CACHE.ttlMs) {
      return res.status(200).json(__CACHE.data);
    }

    const API_KEY = process.env.ETHERSCAN_API_KEY;
    if (!API_KEY) {
      return res.status(500).json({ error: "Missing ETHERSCAN_API_KEY" });
    }

    // =====================
    // CONFIG
    // =====================
    const CONTRACT = "0x10Cd25B8fA6f97356C82aAb8da039C3D7eF18401";
    const EVENT_TOPIC =
      "0x95cfdb8b2e91654ec715d9403064639685780d9bc570c4c0732886c210481b9f";

    const ETHERSCAN_URL =
  "https://api.etherscan.io/v2/api" +
  "?chainid=1" +
  "&module=logs" +
  "&action=getLogs" +
  `&address=${CONTRACT}` +
  `&topic0=${EVENT_TOPIC}` +
  "&fromBlock=0" +
  "&toBlock=latest" +
  `&apikey=${API_KEY}`;

    // =====================
    // FETCH LOGS
    // =====================
    const data = await fetchJsonWithRetry(ETHERSCAN_URL, { tries: 4, timeoutMs: 10_000 });

    if (data.status !== "1") {
      return res.status(500).json({ error: "Etherscan error", details: data });
    }

    const logs = data.result;

    // =====================
    // PARSE HELPERS (Python-like robust decode)
    // =====================
    const hexToBigInt = (h) => {
      if (!h) return 0n;
      const s = h.startsWith("0x") ? h : "0x" + h;
      return BigInt(s);
    };

    const splitWords = (dataHex) => {
      const h = (dataHex || "0x").startsWith("0x") ? (dataHex || "0x").slice(2) : (dataHex || "");
      if (!h) return [];
      const padded = h.length % 64 === 0 ? h : h.padStart(Math.ceil(h.length / 64) * 64, "0");
      const out = [];
      for (let i = 0; i < padded.length; i += 64) {
        out.push(BigInt("0x" + padded.slice(i, i + 64)));
      }
      return out;
    };

    // Presale rules (same intent as Python)
    // Expected: 500 - 25000 USD typically (we keep a bit wider)
    const STRICT_USD_MIN = 400;
    const STRICT_USD_MAX = 30000;
    const LOCK_MIN = 0;
    const LOCK_MAX = 12;

    const chooseUsdAmount = (words) => {
      if (!words || words.length === 0) return { usd: 0, slot: null, decimals: null };

      const candidates = [];

      const maxSlots = Math.min(words.length, 8);

      // Prefer strict matches; prefer 6 decimals; prefer earlier slots
      for (let i = 0; i < maxSlots; i++) {
        const v = words[i];

        for (const d of [6, 18]) {
          // Convert with BigInt -> Number safely only after scaling
          const denom = 10 ** d;
          const asNum = Number(v) / denom;

          if (Number.isFinite(asNum) && asNum >= STRICT_USD_MIN && asNum <= STRICT_USD_MAX) {
            // sortKey: prefer d=6, then earlier slot
            candidates.push({ pref: d === 6 ? 0 : 1, slot: i, decimals: d, usd: asNum });
          }
        }
      }

      if (candidates.length === 0) return { usd: 0, slot: null, decimals: null };

      candidates.sort((a, b) => (a.pref - b.pref) || (a.slot - b.slot));
      const best = candidates[0];

      // Round to 2 decimals for stability
      return { usd: Number(best.usd.toFixed(2)), slot: best.slot, decimals: best.decimals };
    };

    const chooseLockMonths = (words) => {
      if (!words || words.length === 0) return { lock: null, slot: null };

      const candidates = [];
      const maxSlots = Math.min(words.length, 8);

      for (let i = 0; i < maxSlots; i++) {
        const v = Number(words[i]);
        if (Number.isFinite(v) && v >= LOCK_MIN && v <= LOCK_MAX) {
          // Prefer >1 (avoid flags 0/1 if better exists)
          const penalty = (v === 0 || v === 1) ? 1 : 0;
          candidates.push({ penalty, slot: i, lock: v });
        }
      }

      if (candidates.length === 0) return { lock: null, slot: null };

      candidates.sort((a, b) => (a.penalty - b.penalty) || (a.slot - b.slot));
      return { lock: candidates[0].lock, slot: candidates[0].slot };
    };

    const weiHexToEth = (weiHex) => {
      const v = hexToBigInt(weiHex);
      // Convert to Number (ok for small values like presale ETH)
      return Number(v) / 1e18;
    };


    // =====================
    // PARSE EVENTS
    // =====================
    const events = [];

    for (const lg of logs) {
      const wallet = "0x" + lg.topics[1].slice(26);
      const blockNumber = Number(hexToBigInt(lg.blockNumber));
      const words = splitWords(lg.data);

      const usdPick = chooseUsdAmount(words);
      const lockPick = chooseLockMonths(words);

      // If we cannot decode lock months, skip (like Python would effectively skip)
      if (lockPick.lock === null) continue;

      events.push({
        wallet,
        usd: usdPick.usd,          // decoded USD-like amount from event data
        lockMonths: lockPick.lock,
        tx: lg.transactionHash,
        blockNumber,
      });
    }

    // =====================
    // AGGREGATIONS
    // =====================
    const wallets = {};

// OUR totals (only data_check.txt wallets)
let ourTotalUsd = 0;
let ourTotalUsdNoEth = 0;
const ourPaymentTotals = { USD: 0 };

// OVERALL totals (all wallets)
let overallTotalUsd = 0;
let overallTotalUsdNoEth = 0;
const overallPaymentTotals = { USD: 0 };

    for (const e of events) {
      const isOurWallet = OUR_WALLETS.has(e.wallet.toLowerCase());

      // Wallet objesi (para toplamasak bile tutuyoruz)
      if (!wallets[e.wallet]) {
        wallets[e.wallet] = {
          wallet: e.wallet,
          totalUsd: 0,        // sum of decoded USD across events (only our wallets will be added)
          lastUsd: 0,         // last-bid USD (site-style)
          events: 0,
          lockMonths: [],
          lastLockMonths: null,
          lastBlock: -1,
          is_ours: isOurWallet,

          // ETH info (only computed for our wallets)
          totalEth: 0,
          lastEth: 0,
          ethTxCount: 0,
          // keep txs for ETH detection
          _txs: [],
        };
      }

      wallets[e.wallet].events += 1;
      wallets[e.wallet].lockMonths.push(e.lockMonths);

      // Track last-bid (by blockNumber)
      if (e.blockNumber > wallets[e.wallet].lastBlock) {
        wallets[e.wallet].lastBlock = e.blockNumber;
        wallets[e.wallet].lastUsd = e.usd;
        wallets[e.wallet].lastLockMonths = e.lockMonths;
      }

      // Only keep tx hashes for our wallets (for ETH detection later)
      if (isOurWallet) {
        wallets[e.wallet]._txs.push({ tx: e.tx, blockNumber: e.blockNumber, usd: e.usd });
      }

      // OVERALL totals (all wallets)
      if (e.usd > 0) {
        overallTotalUsd += e.usd;
        overallTotalUsdNoEth += e.usd;
        overallPaymentTotals.USD += e.usd;
      }

      // OUR totals (only our wallets)
      if (isOurWallet && e.usd > 0) {
        ourTotalUsd += e.usd;
        ourTotalUsdNoEth += e.usd;
        ourPaymentTotals.USD += e.usd;
        wallets[e.wallet].totalUsd += e.usd; // keep per-wallet totals only for our wallets
      }
    }

    // =====================
    // ETH DETECTION (only for our wallets)
    // Rule: if tx.value > 0, treat as ETH payment
    // =====================
    const txCache = new Map();

    for (const w of Object.values(wallets)) {
      if (!w.is_ours) continue;

      // Sort txs by blockNumber so we can compute lastEth
      const txs = (w._txs || []).slice().sort((a, b) => a.blockNumber - b.blockNumber);

      for (const t of txs) {
        if (!t.tx) continue;

        // Only investigate ETH when decoded USD is 0 (likely ETH payment)
        if (Number(t.usd || 0) > 0) continue;

        let txObj = txCache.get(t.tx);
        if (!txObj) {
          const txJson = await fetchJsonWithRetry(
            `https://api.etherscan.io/v2/api?chainid=1&module=proxy&action=eth_getTransactionByHash&txhash=${t.tx}&apikey=${API_KEY}`,
            { tries: 3, timeoutMs: 10_000 }
          );
          txObj = txJson && txJson.result ? txJson.result : null;
          txCache.set(t.tx, txObj);
        }

        if (txObj && txObj.value) {
          const ethValueWei = hexToBigInt(txObj.value);
          if (ethValueWei > 0n) {
            const ethAmount = weiHexToEth(txObj.value);
            w.totalEth += ethAmount;
            w.ethTxCount += 1;
            w.lastEth = ethAmount; // last one in sorted order that has ETH
          }
        }
      }

      // Clean internal field
      delete w._txs;

      // Round ETH amounts
      w.totalEth = Number(w.totalEth.toFixed(6));
      w.lastEth = Number(w.lastEth.toFixed(6));
    }

    // =====================
    // OUR totals: last-bid (site-style) vs event-sum
    // =====================
    let ourTotalUsdLastBid = 0;
    let ourUniqueWallets = 0;

    for (const w of Object.values(wallets)) {
      if (!w.is_ours) continue;
      ourUniqueWallets += 1;
      // lastUsd can be 0 if decode failed, we still sum 0
      ourTotalUsdLastBid += (w.lastUsd || 0);
    }
    ourTotalUsdLastBid = Number(ourTotalUsdLastBid.toFixed(2));

    const walletList = Object.values(wallets);

    // =====================
    // RESPONSE
    // =====================
    const payload = {
      updated_at: new Date().toISOString(),

      // raw event stats
      total_events: events.length,
      unique_wallets: walletList.length,

      // OVERALL totals (all wallets)
      overall_total_usd: Number(overallTotalUsd.toFixed(2)),
      overall_total_usd_without_eth: Number(overallTotalUsdNoEth.toFixed(2)),
      overall_payment_totals_usd: {
        USD: Number(overallPaymentTotals.USD.toFixed(2)),
      },

      // OUR totals (only data_check.txt wallets)
      our_total_usd: Number(ourTotalUsd.toFixed(2)),
      our_total_usd_without_eth: Number(ourTotalUsdNoEth.toFixed(2)),
      our_payment_totals_usd: {
        USD: Number(ourPaymentTotals.USD.toFixed(2)),
      },

      // Backward-compatible aliases (old keys)
      total_usd: Number(ourTotalUsd.toFixed(2)),
      total_usd_without_eth: Number(ourTotalUsdNoEth.toFixed(2)),
      payment_totals_usd: { USD: Number(ourPaymentTotals.USD.toFixed(2)) },

      // OUR totals (site-style last bid per wallet)
      our_unique_wallets: ourUniqueWallets,
      our_total_usd_last_bid: ourTotalUsdLastBid,

      wallets: walletList,
    };

    // Cache for a short time to reduce Etherscan timeouts
    __CACHE = { ...__CACHE, at: Date.now(), data: payload };

    return res.status(200).json(payload);

  } catch (err) {
    return res.status(500).json({
      error: "Unhandled error",
      message: err.message,
    });
  }
}
