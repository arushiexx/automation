// ===========================================
// WhatsApp Auto-Reply System
// Sirf PEHLE message pe auto reply — fir manual
// ===========================================

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// ---- CONFIG ----
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "my_secret_verify_token_123";
const PORT = process.env.PORT || 3000;

// Auto-reply message (newlines supported with \n)
const AUTO_REPLY_MESSAGE =
  process.env.AUTO_REPLY_MESSAGE ||
  `Demo ₹39\nFree me demo nahi milega ❌\n\nMeri photo channel me upload hai jaakr dekh lo 👇\n\nJise service chahiye YES likh ke msg kare, rate list bhejungi 💕\n\n📌 Channel: https://whatsapp.com/channel/YOUR_CHANNEL_LINK`;

// ---- CUSTOMER DATABASE (Simple JSON file) ----
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

function saveCustomers(customers) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(customers, null, 2));
  } catch (err) {
    console.error("Error saving customers:", err.message);
  }
}

// Load existing customers on startup
let customers = loadCustomers();
console.log(`📋 Loaded ${Object.keys(customers).length} existing customers`);

// ---- SAFETY: Rate Limiting ----
let repliesSentThisMinute = 0;
const MAX_REPLIES_PER_MINUTE = 30;

// Reset counter every minute
setInterval(() => {
  if (repliesSentThisMinute > 0) {
    console.log(`📊 Replies sent last minute: ${repliesSentThisMinute}`);
  }
  repliesSentThisMinute = 0;
}, 60 * 1000);

// ---- SAFETY: Random Delay (5-15 seconds) ----
function getRandomDelay() {
  const hour = new Date().getHours();
  // Night mode: 12 AM - 7 AM → longer delay (20-60 sec)
  if (hour >= 0 && hour < 7) {
    return Math.floor(Math.random() * 40000) + 20000; // 20-60 sec
  }
  // Normal hours → short delay (5-15 sec)
  return Math.floor(Math.random() * 10000) + 5000; // 5-15 sec
}

// ---- SEND WHATSAPP MESSAGE ----
async function sendWhatsAppMessage(to, message) {
  try {
    const response = await axios({
      method: "POST",
      url: `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      data: {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: {
          body: message,
        },
      },
    });
    console.log(`✅ Reply sent to ${to}`);
    return true;
  } catch (error) {
    console.error(
      `❌ Failed to send to ${to}:`,
      error.response?.data || error.message
    );
    return false;
  }
}

// ---- MARK MESSAGE AS READ (natural feel) ----
async function markAsRead(messageId) {
  try {
    await axios({
      method: "POST",
      url: `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      data: {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      },
    });
  } catch (error) {
    // Ignore read receipt errors
  }
}

// ---- WEBHOOK VERIFICATION (Meta requires this) ----
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified successfully!");
    res.status(200).send(challenge);
  } else {
    console.log("❌ Webhook verification failed");
    res.sendStatus(403);
  }
});

// ---- RECEIVE MESSAGES (Webhook) ----
app.post("/webhook", async (req, res) => {
  // Always respond 200 immediately (Meta requires this)
  res.sendStatus(200);

  try {
    const body = req.body;

    // Check if this is a valid WhatsApp message
    if (
      !body.object ||
      !body.entry ||
      !body.entry[0]?.changes?.[0]?.value?.messages
    ) {
      return;
    }

    const changes = body.entry[0].changes[0];
    const value = changes.value;
    const messages = value.messages;

    if (!messages || messages.length === 0) return;

    for (const message of messages) {
      const from = message.from; // Customer phone number
      const messageId = message.id;
      const timestamp = message.timestamp;
      const customerName =
        value.contacts?.[0]?.profile?.name || "Unknown";

      console.log(
        `📩 Message from ${customerName} (${from}): ${
          message.text?.body || "[media/other]"
        }`
      );

      // Mark message as read (blue ticks - natural feel)
      await markAsRead(messageId);

      // Check: Is this a NEW customer?
      if (customers[from]) {
        console.log(
          `⏭️ Already replied to ${from}. Skipping.`
        );
        continue; // Already sent rate card — do nothing
      }

      // ✅ IMMEDIATELY mark customer as seen (prevents duplicate replies)
      customers[from] = {
        name: customerName,
        firstMessageAt: new Date().toISOString(),
        firstReplyAt: null, // Will update when reply actually sends
        replySent: false, // Pending
      };
      saveCustomers(customers);

      // Safety: Rate limit check
      if (repliesSentThisMinute >= MAX_REPLIES_PER_MINUTE) {
        console.log(
          `⚠️ Rate limit reached (${MAX_REPLIES_PER_MINUTE}/min). Queuing ${from} for later.`
        );
        setTimeout(() => {
          processNewCustomer(from, customerName);
        }, 60000 + getRandomDelay());
        continue;
      }

      // Process new customer with random delay
      const delay = getRandomDelay();
      console.log(
        `⏳ New customer ${customerName} (${from}). Replying in ${Math.round(
          delay / 1000
        )}s...`
      );

      setTimeout(() => {
        processNewCustomer(from, customerName);
      }, delay);
    }
  } catch (error) {
    console.error("❌ Error processing message:", error.message);
  }
});

// ---- PROCESS NEW CUSTOMER ----
async function processNewCustomer(from, customerName) {
  // Check if reply already sent (race condition safety)
  if (customers[from]?.replySent) {
    console.log(`⏭️ Already replied to ${from}. Skipping.`);
    return;
  }

  // Safety: Rate limit re-check
  if (repliesSentThisMinute >= MAX_REPLIES_PER_MINUTE) {
    console.log(`⚠️ Rate limit hit. Retrying ${from} in 60s...`);
    setTimeout(() => {
      processNewCustomer(from, customerName);
    }, 60000);
    return;
  }

  // Send auto-reply
  const success = await sendWhatsAppMessage(from, AUTO_REPLY_MESSAGE);

  if (success) {
    // Update customer record — reply sent
    customers[from] = {
      ...customers[from],
      firstReplyAt: new Date().toISOString(),
      replySent: true,
    };
    saveCustomers(customers);
    repliesSentThisMinute++;

    console.log(
      `✅ Rate card sent to ${customerName} (${from}). Total customers: ${
        Object.keys(customers).length
      }`
    );
  } else {
    console.log(`⚠️ Reply failed for ${from}. Will NOT retry to avoid spam.`);
    // Mark as sent anyway to prevent retry loops
    customers[from].replySent = true;
    saveCustomers(customers);
  }
}

// ---- PRIVACY POLICY ROUTE ----
app.get("/privacy-policy", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Privacy Policy - Automation</title>
      <style>
        body { font-family: sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; line-height: 1.6; }
        h1 { color: #333; }
      </style>
    </head>
    <body>
      <h1>Privacy Policy</h1>
      <p>Last updated: August 19, 2026</p>
      <p>This Privacy Policy describes how your personal information is collected, used, and shared when you interact with our WhatsApp Auto-Reply service.</p>
      <h2>Information We Collect</h2>
      <p>When you send a message to our WhatsApp service, we collect your phone number, profile name, and the text of your message to automatically reply to your queries.</p>
      <h2>How We Use Your Information</h2>
      <p>We use the information we collect solely to provide automated responses and rate card details requested by you.</p>
      <h2>Data Retention</h2>
      <p>We store phone numbers strictly for rate-limiting and preventing duplicate spam responses.</p>
      <h2>Contact Us</h2>
      <p>If you have any questions about this Privacy Policy, please contact us at arushiexx@gmail.com.</p>
    </body>
    </html>
  `);
});

// ---- HEALTH CHECK / STATS ----
app.get("/", (req, res) => {
  const totalCustomers = Object.keys(customers).length;
  const today = new Date().toISOString().split("T")[0];
  const todayCustomers = Object.values(customers).filter((c) =>
    c.firstReplyAt?.startsWith(today)
  ).length;

  res.json({
    status: "✅ Running",
    message: "WhatsApp Auto-Reply System",
    stats: {
      totalCustomers,
      todayReplies: todayCustomers,
      repliesThisMinute: repliesSentThisMinute,
      maxPerMinute: MAX_REPLIES_PER_MINUTE,
    },
  });
});

// ---- UPDATE AUTO-REPLY MESSAGE ----
app.post("/update-message", express.json(), (req, res) => {
  const { message, secret } = req.body;
  if (secret !== VERIFY_TOKEN) {
    return res.status(403).json({ error: "Unauthorized" });
  }
  if (!message) {
    return res.status(400).json({ error: "Message required" });
  }
  process.env.AUTO_REPLY_MESSAGE = message;
  console.log(`📝 Auto-reply message updated!`);
  res.json({ success: true, newMessage: message });
});

// ---- START SERVER ----
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║   WhatsApp Auto-Reply System                  ║
║   🟢 Server running on port ${PORT}              ║
║   📋 ${Object.keys(customers).length} customers in database            ║
║   🛡️ Max ${MAX_REPLIES_PER_MINUTE} replies/minute                  ║
║   ⏳ Random delay: 5-15s (night: 20-60s)      ║
╚═══════════════════════════════════════════════╝
  `);
});
