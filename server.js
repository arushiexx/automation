// ==========================================================
// WhatsApp Web Auto-Reply System (Baileys QR-Based)
// Sirf PEHLE message pe auto-reply — fir full manual chat
// ==========================================================

require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const pino = require("pino");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// ---- AUTO-REPLY MESSAGE CONFIG ----
let AUTO_REPLY_MESSAGE =
  process.env.AUTO_REPLY_MESSAGE ||
  `Demo ₹39\nFree me demo nahi milega ❌\n\nMeri photo channel me upload hai jaakr dekh lo 👇\n\nJise service chahiye YES likh ke msg kare, rate list bhejungi 💕\n\n📌 Channel: https://whatsapp.com/channel/YOUR_CHANNEL_LINK`;

// ---- DATABASE: CUSTOMERS (JSON file) ----
const DB_FILE = path.join(__dirname, "customers.json");

function loadCustomers() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("Error loading customers:", err.message);
  }
  return {};
}

function saveCustomers(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error saving customers:", err.message);
  }
}

let customers = loadCustomers();
console.log(`📋 Loaded ${Object.keys(customers).length} customers from database.`);

// ---- SAFETY: Rate Limiting & Delays ----
let repliesSentThisMinute = 0;
const MAX_REPLIES_PER_MINUTE = 30;

setInterval(() => {
  if (repliesSentThisMinute > 0) {
    console.log(`📊 Replies sent in last minute: ${repliesSentThisMinute}`);
  }
  repliesSentThisMinute = 0;
}, 60 * 1000);

function getRandomDelay() {
  const hour = new Date().getHours();
  // Night Mode: 12 AM - 7 AM -> 20-60 sec
  if (hour >= 0 && hour < 7) {
    return Math.floor(Math.random() * 40000) + 20000;
  }
  // Daytime: 5-15 sec natural delay
  return Math.floor(Math.random() * 10000) + 5000;
}

// ---- STATE MANAGEMENT ----
let currentQrDataUrl = null;
let connectionStatus = "Connecting...";
let connectedUser = null;
let sock = null;

// ---- BAILEYS WHATSAPP CONNECTION ----
async function startWhatsApp() {
  const authFolder = path.join(__dirname, "auth_info_baileys");
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  console.log(`🚀 Starting WhatsApp Web Bot v${version.join(".")} (Latest: ${isLatest})`);

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: true,
    browser: ["WhatsApp AutoReply", "Chrome", "1.0.0"],
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      connectionStatus = "QR_READY";
      currentQrDataUrl = await qrcode.toDataURL(qr);
      console.log("\n📲 [QR CODE READY] Please scan the QR Code on screen or terminal!\n");
    }

    if (connection === "open") {
      connectionStatus = "CONNECTED";
      currentQrDataUrl = null;
      connectedUser = sock.user?.id ? sock.user.id.split(":")[0] : "Connected";
      console.log(`\n🟢 [SUCCESS] WhatsApp Connected Successfully as +${connectedUser}!\n`);
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      connectionStatus = shouldReconnect ? "RECONNECTING" : "LOGGED_OUT";
      currentQrDataUrl = null;
      console.log(
        `🔴 Connection closed due to: ${lastDisconnect?.error?.message || "Unknown"}, reconnecting: ${shouldReconnect}`
      );

      if (shouldReconnect) {
        setTimeout(startWhatsApp, 3000);
      } else {
        console.log("⚠️ Logged out. Clearing auth folder and restarting for new QR...");
        try {
          fs.rmSync(authFolder, { recursive: true, force: true });
        } catch (e) {}
        setTimeout(startWhatsApp, 2000);
      }
    }
  });

  // ---- LISTEN FOR INCOMING MESSAGES ----
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      try {
        // Skip messages sent by self
        if (msg.key.fromMe) continue;

        const sender = msg.key.remoteJid;

        // Skip status broadcast and groups
        if (!sender || sender.includes("status@broadcast") || sender.includes("@g.us")) {
          continue;
        }

        const phoneNumber = sender.replace("@s.whatsapp.net", "");
        const pushName = msg.pushName || "Customer";

        // Extract message text if any
        const messageText =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          "[Media/Other]";

        console.log(`📩 New message from ${pushName} (+${phoneNumber}): "${messageText}"`);

        // Check if customer already received rate card / auto-reply
        if (customers[phoneNumber]) {
          console.log(`⏭️ Already replied to +${phoneNumber}. Skipping auto-reply for manual chat.`);
          continue;
        }

        // Immediately save customer to prevent duplicate replies during delay
        customers[phoneNumber] = {
          name: pushName,
          firstMessageAt: new Date().toISOString(),
          firstReplyAt: null,
          replySent: false,
        };
        saveCustomers(customers);

        // Calculate natural delay
        const delay = getRandomDelay();
        console.log(
          `⏳ New customer detected: +${phoneNumber} (${pushName}). Sending auto-reply in ${Math.round(
            delay / 1000
          )}s...`
        );

        setTimeout(async () => {
          await processAutoReply(sender, phoneNumber, pushName, msg.key);
        }, delay);
      } catch (err) {
        console.error("Error processing message:", err.message);
      }
    }
  });
}

// ---- SEND AUTO-REPLY ----
async function processAutoReply(jid, phoneNumber, pushName, messageKey) {
  // Safety check: already sent?
  if (customers[phoneNumber]?.replySent) return;

  // Safety check: rate limit
  if (repliesSentThisMinute >= MAX_REPLIES_PER_MINUTE) {
    console.log(`⚠️ Rate limit reached (${MAX_REPLIES_PER_MINUTE}/min). Retrying in 60s for +${phoneNumber}`);
    setTimeout(() => {
      processAutoReply(jid, phoneNumber, pushName, messageKey);
    }, 60000);
    return;
  }

  try {
    // Send Read Receipt (Blue Ticks)
    if (sock && messageKey) {
      await sock.readMessages([messageKey]);
    }

    // Send the Auto-Reply Message
    if (sock) {
      await sock.sendMessage(jid, { text: AUTO_REPLY_MESSAGE });
      repliesSentThisMinute++;

      // Update Database
      customers[phoneNumber] = {
        ...customers[phoneNumber],
        firstReplyAt: new Date().toISOString(),
        replySent: true,
      };
      saveCustomers(customers);

      console.log(
        `✅ [AUTO-REPLY SENT] Rate card delivered to +${phoneNumber} (${pushName}). Total unique customers: ${
          Object.keys(customers).length
        }`
      );
    }
  } catch (error) {
    console.error(`❌ Failed to send reply to +${phoneNumber}:`, error.message);
    if (customers[phoneNumber]) {
      customers[phoneNumber].replySent = true;
      saveCustomers(customers);
    }
  }
}

// ---- WEB DASHBOARD & API ----
app.get("/", (req, res) => {
  const total = Object.keys(customers).length;
  const today = new Date().toISOString().split("T")[0];
  const todayCount = Object.values(customers).filter((c) =>
    c.firstReplyAt?.startsWith(today)
  ).length;

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>WhatsApp Auto-Reply Dashboard</title>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Outfit', sans-serif; }
        body { background: #0f172a; color: #f8fafc; min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 30px 15px; }
        .container { max-width: 850px; width: 100%; }
        header { text-align: center; margin-bottom: 25px; }
        h1 { font-size: 2.2rem; background: linear-gradient(135deg, #25D366, #128C7E); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .badge { display: inline-block; padding: 6px 14px; border-radius: 50px; font-weight: 600; font-size: 0.85rem; margin-top: 10px; }
        .badge.connected { background: rgba(37, 211, 102, 0.2); color: #25D366; border: 1px solid #25D366; }
        .badge.qr { background: rgba(234, 179, 8, 0.2); color: #eab308; border: 1px solid #eab308; }
        .badge.disconnected { background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid #ef4444; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 15px; margin-bottom: 25px; }
        .card { background: #1e293b; border-radius: 16px; padding: 20px; border: 1px solid #334155; box-shadow: 0 10px 25px rgba(0,0,0,0.3); }
        .card h3 { font-size: 0.9rem; color: #94a3b8; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
        .card .stat { font-size: 2rem; font-weight: 700; color: #38bdf8; }
        .qr-section { background: #1e293b; border-radius: 16px; padding: 30px; border: 1px solid #334155; text-align: center; margin-bottom: 25px; }
        .qr-box { background: white; padding: 15px; border-radius: 12px; display: inline-block; margin: 15px 0; }
        .qr-box img { display: block; width: 250px; height: 250px; }
        .instructions { color: #cbd5e1; font-size: 0.95rem; line-height: 1.6; max-width: 500px; margin: 0 auto 15px; text-align: left; background: #0f172a; padding: 15px; border-radius: 10px; }
        .editor-section { background: #1e293b; border-radius: 16px; padding: 25px; border: 1px solid #334155; margin-bottom: 25px; }
        textarea { width: 100%; height: 160px; background: #0f172a; color: #f8fafc; border: 1px solid #334155; border-radius: 10px; padding: 15px; font-size: 1rem; line-height: 1.5; resize: vertical; outline: none; }
        textarea:focus { border-color: #25D366; }
        .btn { background: #25D366; color: #0f172a; font-weight: 700; padding: 12px 24px; border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; transition: 0.2s; margin-top: 10px; }
        .btn:hover { background: #1eb956; transform: translateY(-1px); }
        .connected-box { background: rgba(37, 211, 102, 0.1); border: 1px solid #25D366; padding: 25px; border-radius: 12px; }
        .btn-restart { background: #ef4444; color: white; padding: 8px 16px; border-radius: 6px; font-size: 0.85rem; border: none; cursor: pointer; }
      </style>
    </head>
    <body>
      <div class="container">
        <header>
          <h1>WhatsApp Auto-Reply System</h1>
          <div class="badge ${
            connectionStatus === "CONNECTED"
              ? "connected"
              : connectionStatus === "QR_READY"
              ? "qr"
              : "disconnected"
          }">
            ● ${connectionStatus === "CONNECTED" ? `Connected (+${connectedUser})` : connectionStatus === "QR_READY" ? "Scan QR Code Below" : connectionStatus}
          </div>
        </header>

        <div class="grid">
          <div class="card">
            <h3>Total Unique Customers</h3>
            <div class="stat">${total}</div>
          </div>
          <div class="card">
            <h3>Replies Sent Today</h3>
            <div class="stat">${todayCount}</div>
          </div>
          <div class="card">
            <h3>Rate Limit & Delay</h3>
            <div class="stat" style="font-size: 1.3rem; margin-top: 8px; color: #a855f7;">5-15s / 30pm</div>
          </div>
        </div>

        ${
          connectionStatus === "CONNECTED"
            ? `
          <div class="qr-section connected-box">
            <h2 style="color: #25D366; margin-bottom: 10px;">🟢 Bot Active & Running!</h2>
            <p style="color: #cbd5e1; margin-bottom: 15px;">Aapka WhatsApp number (+${connectedUser}) successfully connected hai.<br>Pehle message par turant auto-reply jayega aur baad me aap apne phone se manual baat kar sakte hain.</p>
            <form action="/relink" method="POST" onsubmit="return confirm('Kya aap naye number se QR scan karna chahte hain?')">
              <button type="submit" class="btn-restart">Change Account / Re-scan QR</button>
            </form>
          </div>
        `
            : `
          <div class="qr-section">
            <h2>📲 Link WhatsApp (Scan QR Code)</h2>
            <div class="instructions">
              <strong>Kaise connect karein:</strong><br>
              1. Apne phone me WhatsApp kholein (<strong>9540860818</strong>).<br>
              2. <strong>⋮ (3 dots)</strong> ya <strong>Settings</strong> par jayein.<br>
              3. <strong>Linked Devices (लिंक्ड डिवाइस)</strong> par click karein.<br>
              4. <strong>Link a Device</strong> dabakar neeche diye gaye QR code ko scan karein.
            </div>
            ${
              currentQrDataUrl
                ? `<div class="qr-box"><img src="${currentQrDataUrl}" alt="WhatsApp QR Code"></div>`
                : `<p style="padding: 40px; color: #94a3b8;">⏳ Generating QR Code... (Auto-refreshing in 3s)</p>`
            }
          </div>
        `
        }

        <div class="editor-section">
          <h2 style="margin-bottom: 15px;">📝 Auto-Reply Message (Rate Card / Demo)</h2>
          <form action="/update-message" method="POST">
            <textarea name="message" placeholder="Type your auto reply text here...">${AUTO_REPLY_MESSAGE}</textarea>
            <br>
            <button type="submit" class="btn">💾 Save Auto-Reply Message</button>
          </form>
        </div>
      </div>

      <script>
        const status = "${connectionStatus}";
        if (status !== "CONNECTED") {
          setTimeout(() => {
            window.location.reload();
          }, 3000);
        }
      </script>
    </body>
    </html>
  `);
});

app.post("/update-message", (req, res) => {
  const { message } = req.body;
  if (message && message.trim()) {
    AUTO_REPLY_MESSAGE = message.trim();
    console.log("📝 Auto-reply message updated from dashboard!");
  }
  res.redirect("/");
});

app.post("/relink", (req, res) => {
  try {
    if (sock) {
      sock.logout().catch(() => {});
    }
    const authFolder = path.join(__dirname, "auth_info_baileys");
    fs.rmSync(authFolder, { recursive: true, force: true });
  } catch (e) {}
  setTimeout(() => {
    startWhatsApp();
    res.redirect("/");
  }, 1000);
});

startWhatsApp();

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║   WhatsApp Web Auto-Reply Bot                              ║
║   🟢 Dashboard: http://localhost:${PORT}                     ║
║   📋 ${Object.keys(customers).length} customers in database                             ║
║   🛡️ Safety: 5-15s delay, 30 replies/min                   ║
╚════════════════════════════════════════════════════════════╝
  `);
});
