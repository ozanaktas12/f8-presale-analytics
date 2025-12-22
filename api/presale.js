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
    const response = await fetch(ETHERSCAN_URL);
    const data = await response.json();

    if (data.status !== "1") {
      return res.status(500).json({ error: "Etherscan error", details: data });
    }

    const logs = data.result;

    // =====================
    // PARSE HELPERS
    // =====================
    const hexToInt = (h) => parseInt(h, 16);

    const parseUSD = (hex) => {
      const raw = hexToInt(hex);
      // USDT/USDC 6 decimals
      const usd = raw / 1_000_000;

      // ❗ Presale kuralı: tek event max 25.000 USD olabilir
      if (usd <= 0 || usd > 25_000) {
        return 0;
      }
      return usd;
    };


    // =====================
    // PARSE EVENTS
    // =====================
    const events = [];

    for (const lg of logs) {
      const wallet = "0x" + lg.topics[1].slice(26);

      const chunks = lg.data
        .replace("0x", "")
        .match(/.{64}/g);

      // Python-style: amount is directly encoded
      const usd = parseUSD(chunks[0]);
      const lockMonths = hexToInt(chunks[2]);

      events.push({
        wallet,
        usd,
        lockMonths,
        payment: "USD",
        tx: lg.transactionHash,
      });
    }

    // =====================
    // AGGREGATIONS
    // =====================
    const wallets = {};
    let totalUsd = 0;

    const paymentTotals = {
      USD: 0,
    };
    let totalUsdNoEth = 0;

    for (const e of events) {
      const isOurWallet = OUR_WALLETS.has(e.wallet.toLowerCase());

      // Wallet objesi (para toplamasak bile tutuyoruz)
      if (!wallets[e.wallet]) {
        wallets[e.wallet] = {
          wallet: e.wallet,
          totalUsd: 0,
          events: 0,
          lockMonths: [],
          is_ours: isOurWallet,
        };
      }

      wallets[e.wallet].events += 1;
      wallets[e.wallet].lockMonths.push(e.lockMonths);

      // ❗ SADECE BİZİM CÜZDANLAR PARA TOPLAR
      if (isOurWallet) {
        // usd 0 ise (ETH ya da geçersiz event) toplama dahil etme
        if (e.usd > 0) {
          totalUsd += e.usd;
          totalUsdNoEth += e.usd;
          paymentTotals.USD += e.usd;
          wallets[e.wallet].totalUsd += e.usd;
        }
      }
    }

    const walletList = Object.values(wallets);

    // =====================
    // RESPONSE
    // =====================
    return res.status(200).json({
      updated_at: new Date().toISOString(),
      total_events: events.length,
      unique_wallets: walletList.length,
      total_usd: Number(totalUsd.toFixed(2)),
      total_usd_without_eth: Number(totalUsdNoEth.toFixed(2)),
      payment_totals_usd: {
        USD: Number(paymentTotals.USD.toFixed(2)),
      },
      wallets: walletList,
    });

  } catch (err) {
    return res.status(500).json({
      error: "Unhandled error",
      message: err.message,
    });
  }
}
