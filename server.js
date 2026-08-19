// ===========================================
// WhatsApp Auto-Reply System + Live Chat Dashboard
// Auto reply on first message + Manual reply via dashboard
// ===========================================

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---- FILE UPLOAD CONFIG (for DP) ----
const upload = multer({ dest: path.join(__dirname, "uploads/") });

// ---- CONFIG ----
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "my_secret_verify_token_123";
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "9569";
const APP_ID = process.env.APP_ID || "1529253259236329";
const PORT = process.env.PORT || 3000;

// Auto-reply message
let AUTO_REPLY_MESSAGE =
  process.env.AUTO_REPLY_MESSAGE ||
  `Demo ₹39\nFree me demo nahi milega ❌\n\nMeri photo channel me upload hai jaakr dekh lo 👇\n\nJise service chahiye YES likh ke msg kare, rate list bhejungi 💕\n\n📌 Channel: https://whatsapp.com/channel/0029Vb8iWeuKGGGE9pLrhA2k`;

// ---- DATABASES ----
const DB_FILE = path.join(__dirname, "customers.json");
const MSG_FILE = path.join(__dirname, "messages.json");

function loadJSON(file) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) { console.error("Error loading", file, e.message); }
  return {};
}
function saveJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
  catch (e) { console.error("Error saving", file, e.message); }
}

let customers = loadJSON(DB_FILE);
let messages = loadJSON(MSG_FILE);
console.log(`📋 Loaded ${Object.keys(customers).length} customers, ${Object.keys(messages).length} conversations`);

// ---- SAFETY: Rate Limiting ----
let repliesSentThisMinute = 0;
const MAX_REPLIES_PER_MINUTE = 30;
setInterval(() => { repliesSentThisMinute = 0; }, 60000);

// ---- RANDOM DELAY ----
function getRandomDelay() {
  const hour = new Date().getHours();
  if (hour >= 0 && hour < 7) return Math.floor(Math.random() * 40000) + 20000;
  return Math.floor(Math.random() * 10000) + 5000;
}

// ---- STORE MESSAGE ----
function storeMessage(phone, name, text, direction) {
  if (!messages[phone]) messages[phone] = { name: name || "Unknown", msgs: [] };
  if (name && name !== "Unknown") messages[phone].name = name;
  messages[phone].msgs.push({
    text: text,
    dir: direction, // "in" or "out"
    ts: new Date().toISOString()
  });
  // Keep last 200 messages per conversation
  if (messages[phone].msgs.length > 200) {
    messages[phone].msgs = messages[phone].msgs.slice(-200);
  }
  saveJSON(MSG_FILE, messages);
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
        text: { body: message },
      },
    });
    console.log(`✅ Reply sent to ${to}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to send to ${to}:`, error.response?.data || error.message);
    return false;
  }
}

// ---- MARK AS READ ----
async function markAsRead(messageId) {
  try {
    await axios({
      method: "POST",
      url: `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      data: { messaging_product: "whatsapp", status: "read", message_id: messageId },
    });
  } catch (e) { /* ignore */ }
}

// ---- WEBHOOK VERIFICATION ----
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ---- RECEIVE MESSAGES ----
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (!body.object || !body.entry || !body.entry[0]?.changes?.[0]?.value?.messages) return;

    const value = body.entry[0].changes[0].value;
    const msgs = value.messages;
    if (!msgs || msgs.length === 0) return;

    for (const message of msgs) {
      const from = message.from;
      const messageId = message.id;
      const customerName = value.contacts?.[0]?.profile?.name || "Unknown";
      const msgText = message.text?.body || "[media/other]";

      console.log(`📩 Message from ${customerName} (${from}): ${msgText}`);

      // Store incoming message
      storeMessage(from, customerName, msgText, "in");

      // Mark as read
      await markAsRead(messageId);

      // Auto-reply only to NEW customers
      if (customers[from]) {
        console.log(`⏭️ Already replied to ${from}. Skipping auto-reply.`);
        continue;
      }

      customers[from] = {
        name: customerName,
        firstMessageAt: new Date().toISOString(),
        replySent: false,
      };
      saveJSON(DB_FILE, customers);

      if (repliesSentThisMinute >= MAX_REPLIES_PER_MINUTE) {
        setTimeout(() => processNewCustomer(from, customerName), 60000 + getRandomDelay());
        continue;
      }

      const delay = getRandomDelay();
      console.log(`⏳ New customer ${customerName}. Replying in ${Math.round(delay / 1000)}s...`);
      setTimeout(() => processNewCustomer(from, customerName), delay);
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
});

// ---- PROCESS NEW CUSTOMER ----
async function processNewCustomer(from, customerName) {
  if (customers[from]?.replySent) return;
  if (repliesSentThisMinute >= MAX_REPLIES_PER_MINUTE) {
    setTimeout(() => processNewCustomer(from, customerName), 60000);
    return;
  }
  const success = await sendWhatsAppMessage(from, AUTO_REPLY_MESSAGE);
  if (success) {
    storeMessage(from, customerName, AUTO_REPLY_MESSAGE, "out");
    repliesSentThisMinute++;
  }
  customers[from] = { ...customers[from], replySent: true, firstReplyAt: new Date().toISOString() };
  saveJSON(DB_FILE, customers);
}

// ============================================
// DASHBOARD API ENDPOINTS
// ============================================

// ---- AUTH MIDDLEWARE ----
function authCheck(req, res, next) {
  const token = req.headers["x-auth-token"] || req.query.token;
  if (token === DASHBOARD_PASSWORD) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// ---- GET CONVERSATIONS ----
app.get("/api/conversations", authCheck, (req, res) => {
  const convos = [];
  for (const [phone, data] of Object.entries(messages)) {
    const lastMsg = data.msgs[data.msgs.length - 1];
    const unread = data.msgs.filter(m => m.dir === "in" && !m.read).length;
    convos.push({
      phone, name: data.name,
      lastMessage: lastMsg?.text || "",
      lastTime: lastMsg?.ts || "",
      unread: unread,
      msgCount: data.msgs.length
    });
  }
  convos.sort((a, b) => new Date(b.lastTime) - new Date(a.lastTime));
  res.json(convos);
});

// ---- GET MESSAGES FOR A CONTACT ----
app.get("/api/messages/:phone", authCheck, (req, res) => {
  const phone = req.params.phone;
  if (!messages[phone]) return res.json({ name: "Unknown", msgs: [] });
  res.json(messages[phone]);
});

// ---- SEND MANUAL MESSAGE ----
app.post("/api/send", authCheck, async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ error: "phone and message required" });
  
  const success = await sendWhatsAppMessage(phone, message);
  if (success) {
    const name = messages[phone]?.name || customers[phone]?.name || "Unknown";
    storeMessage(phone, name, message, "out");
    res.json({ success: true });
  } else {
    res.status(500).json({ error: "Failed to send" });
  }
});

// ---- DELETE CUSTOMER HISTORY (so auto-reply fires again) ----
app.delete("/api/customer/:phone", authCheck, (req, res) => {
  const phone = req.params.phone;
  delete customers[phone];
  saveJSON(DB_FILE, customers);
  // Also clear message history
  delete messages[phone];
  saveJSON(MSG_FILE, messages);
  res.json({ success: true, message: `Cleared history for ${phone}` });
});

// ---- UPDATE AUTO-REPLY MESSAGE ----
app.post("/api/auto-reply", authCheck, (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "message required" });
  AUTO_REPLY_MESSAGE = message;
  process.env.AUTO_REPLY_MESSAGE = message;
  res.json({ success: true, newMessage: message });
});

// ---- GET AUTO-REPLY MESSAGE ----
app.get("/api/auto-reply", authCheck, (req, res) => {
  res.json({ message: AUTO_REPLY_MESSAGE });
});

// ---- UPDATE PROFILE PICTURE ----
app.post("/api/profile/picture", authCheck, upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No photo uploaded" });
    
    const filePath = req.file.path;
    const fileSize = req.file.size;
    const mimeType = req.file.mimetype || "image/jpeg";

    // Step 1: Create upload session
    const initRes = await axios.post(
      `https://graph.facebook.com/v21.0/${APP_ID}/uploads`,
      null,
      {
        params: { access_token: WHATSAPP_TOKEN, file_length: fileSize, file_type: mimeType },
      }
    );
    const sessionId = initRes.data.id;

    // Step 2: Upload binary
    const fileBuffer = fs.readFileSync(filePath);
    const uploadRes = await axios.post(
      `https://graph.facebook.com/v21.0/${sessionId}`,
      fileBuffer,
      {
        headers: {
          Authorization: `OAuth ${WHATSAPP_TOKEN}`,
          file_offset: 0,
          "Content-Type": mimeType,
        },
      }
    );
    const handle = uploadRes.data.h;

    // Step 3: Update profile
    await axios.post(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/whatsapp_business_profile`,
      { messaging_product: "whatsapp", profile_picture_handle: handle },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );

    // Cleanup uploaded file
    fs.unlinkSync(filePath);

    res.json({ success: true, message: "DP updated!" });
  } catch (error) {
    console.error("DP update error:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data?.error?.message || "Failed to update DP" });
  }
});

// ---- GET PROFILE INFO ----
app.get("/api/profile", authCheck, async (req, res) => {
  try {
    const r = await axios.get(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`,
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
    res.json(r.data?.data?.[0] || {});
  } catch (e) {
    res.status(500).json({ error: e.response?.data || e.message });
  }
});

// ---- UPDATE PROFILE INFO ----
app.post("/api/profile", authCheck, async (req, res) => {
  try {
    const { about, description, address, email, websites } = req.body;
    const data = { messaging_product: "whatsapp" };
    if (about) data.about = about;
    if (description) data.description = description;
    if (address) data.address = address;
    if (email) data.email = email;
    if (websites) data.websites = websites;

    await axios.post(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/whatsapp_business_profile`,
      data,
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.response?.data || e.message });
  }
});

// ---- PRIVACY POLICY ----
app.get("/privacy-policy", (req, res) => {
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Privacy Policy</title><style>body{font-family:'Segoe UI',sans-serif;padding:40px;max-width:800px;margin:0 auto;line-height:1.7;color:#333}h1{color:#1a73e8;border-bottom:2px solid #e8eaed;padding-bottom:10px}h2{color:#202124;margin-top:25px}.footer{margin-top:40px;font-size:.9em;color:#70757a;border-top:1px solid #e8eaed;padding-top:15px}</style></head><body><h1>Privacy Policy</h1><p><strong>Effective Date:</strong> August 19, 2026</p><p>Your privacy is important to us. We do not collect, store, or sell any personal data.</p><h2>Contact</h2><p>arushiexx@gmail.com</p><div class="footer">&copy; 2026 Automation</div></body></html>`);
});

// ============================================
// WHATSAPP WEB CLONE - CHAT DASHBOARD
// ============================================
app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// ---- START SERVER ----
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║   WhatsApp Auto-Reply + Live Chat Dashboard   ║
║   🟢 Server running on port \${PORT}              ║
║   📋 \${Object.keys(customers).length} customers in database            ║
║   💬 \${Object.keys(messages).length} conversations stored             ║
║   🛡️ Max \${MAX_REPLIES_PER_MINUTE} replies/minute                  ║
║   🌐 Dashboard: /chat                        ║
╚═══════════════════════════════════════════════╝
  `);
});
