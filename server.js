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
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "admin123";
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

// ---- HEALTH CHECK ----
app.get("/", (req, res) => {
  res.json({
    status: "✅ Running",
    message: "WhatsApp Auto-Reply System",
    stats: {
      totalCustomers: Object.keys(customers).length,
      todayReplies: Object.values(customers).filter(c => c.firstReplyAt?.startsWith(new Date().toISOString().split("T")[0])).length,
      totalConversations: Object.keys(messages).length,
      repliesThisMinute: repliesSentThisMinute,
    },
  });
});

// ============================================
// WHATSAPP WEB CLONE - CHAT DASHBOARD
// ============================================
app.get("/chat", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WhatsApp Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:'Inter',sans-serif; background:#111b21; color:#e9edef; height:100vh; overflow:hidden; }

/* LOGIN SCREEN */
#loginScreen { display:flex; align-items:center; justify-content:center; height:100vh; background:linear-gradient(135deg,#0a1014,#1a2a33); }
.login-box { background:#1f2c34; padding:40px; border-radius:12px; text-align:center; width:360px; box-shadow:0 8px 32px rgba(0,0,0,.4); }
.login-box h2 { color:#00a884; margin-bottom:8px; font-size:22px; }
.login-box p { color:#8696a0; font-size:13px; margin-bottom:24px; }
.login-box input { width:100%; padding:12px 16px; background:#2a3942; border:1px solid #374045; border-radius:8px; color:#e9edef; font-size:15px; outline:none; margin-bottom:16px; }
.login-box input:focus { border-color:#00a884; }
.login-box button { width:100%; padding:12px; background:#00a884; color:#fff; border:none; border-radius:8px; font-size:15px; font-weight:600; cursor:pointer; transition:.2s; }
.login-box button:hover { background:#008f72; }
.login-error { color:#ea4335; font-size:13px; margin-top:8px; display:none; }

/* MAIN APP */
#app { display:none; height:100vh; }
.container { display:flex; height:100%; max-width:100%; }

/* LEFT SIDEBAR */
.sidebar { width:360px; min-width:360px; background:#111b21; border-right:1px solid #222d34; display:flex; flex-direction:column; }
.sidebar-header { padding:12px 16px; background:#1f2c34; display:flex; align-items:center; justify-content:space-between; min-height:56px; }
.sidebar-header h3 { color:#e9edef; font-size:18px; font-weight:600; }
.header-btns { display:flex; gap:8px; }
.header-btn { background:none; border:none; color:#8696a0; cursor:pointer; font-size:18px; padding:6px 8px; border-radius:6px; transition:.2s; }
.header-btn:hover { background:#2a3942; color:#00a884; }

.search-box { padding:8px 12px; background:#111b21; }
.search-box input { width:100%; padding:8px 32px 8px 12px; background:#2a3942; border:none; border-radius:8px; color:#e9edef; font-size:14px; outline:none; }

.contact-list { flex:1; overflow-y:auto; }
.contact-list::-webkit-scrollbar { width:5px; }
.contact-list::-webkit-scrollbar-thumb { background:#374045; border-radius:4px; }

.contact-item { display:flex; align-items:center; padding:12px 16px; cursor:pointer; transition:.15s; border-bottom:1px solid #222d34; }
.contact-item:hover { background:#2a3942; }
.contact-item.active { background:#2a3942; }
.contact-avatar { width:44px; height:44px; border-radius:50%; background:#00a884; display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:600; color:#fff; margin-right:12px; flex-shrink:0; }
.contact-info { flex:1; min-width:0; }
.contact-name { font-size:15px; font-weight:500; color:#e9edef; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.contact-last { font-size:13px; color:#8696a0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px; }
.contact-time { font-size:11px; color:#8696a0; white-space:nowrap; margin-left:8px; }
.contact-unread { background:#00a884; color:#fff; font-size:11px; font-weight:700; padding:2px 6px; border-radius:10px; margin-left:8px; }

/* RIGHT CHAT AREA */
.chat-area { flex:1; display:flex; flex-direction:column; background:#0b141a; }

/* EMPTY STATE */
.empty-chat { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#8696a0; }
.empty-chat .icon { font-size:80px; margin-bottom:20px; opacity:.4; }
.empty-chat h3 { font-size:24px; font-weight:300; color:#e9edef; margin-bottom:8px; }
.empty-chat p { font-size:14px; }

/* CHAT HEADER */
.chat-header { padding:10px 16px; background:#1f2c34; display:flex; align-items:center; min-height:56px; border-bottom:1px solid #222d34; }
.chat-header-avatar { width:38px; height:38px; border-radius:50%; background:#00a884; display:flex; align-items:center; justify-content:center; font-size:16px; font-weight:600; color:#fff; margin-right:12px; }
.chat-header-name { font-size:15px; font-weight:500; }
.chat-header-phone { font-size:12px; color:#8696a0; }
.chat-header-actions { margin-left:auto; display:flex; gap:4px; }
.chat-action-btn { background:none; border:none; color:#8696a0; cursor:pointer; font-size:16px; padding:6px 8px; border-radius:6px; }
.chat-action-btn:hover { background:#2a3942; color:#ea4335; }

/* MESSAGES */
.messages-area { flex:1; overflow-y:auto; padding:16px 60px; background-image:url("data:image/svg+xml,%3Csvg width='200' height='200' xmlns='http://www.w3.org/2000/svg'%3E%3Cdefs%3E%3Cpattern id='p' width='40' height='40' patternUnits='userSpaceOnUse'%3E%3Ccircle cx='20' cy='20' r='1' fill='%23ffffff' opacity='.02'/%3E%3C/pattern%3E%3C/defs%3E%3Crect fill='url(%23p)' width='200' height='200'/%3E%3C/svg%3E"); }
.messages-area::-webkit-scrollbar { width:5px; }
.messages-area::-webkit-scrollbar-thumb { background:#374045; border-radius:4px; }

.msg-bubble { max-width:65%; padding:8px 12px; margin-bottom:4px; border-radius:8px; font-size:14px; line-height:1.4; position:relative; word-wrap:break-word; clear:both; }
.msg-in { background:#1f2c34; float:left; border-top-left-radius:0; }
.msg-out { background:#005c4b; float:right; border-top-right-radius:0; }
.msg-time { font-size:11px; color:rgba(255,255,255,.5); text-align:right; margin-top:4px; }
.msg-day { clear:both; text-align:center; margin:16px 0; }
.msg-day span { background:#1a2730; color:#8696a0; padding:4px 12px; border-radius:6px; font-size:12px; }

/* INPUT BAR */
.input-bar { padding:8px 16px; background:#1f2c34; display:flex; align-items:center; gap:8px; }
.input-bar input { flex:1; padding:10px 16px; background:#2a3942; border:none; border-radius:8px; color:#e9edef; font-size:14px; outline:none; }
.input-bar button { padding:10px 16px; background:#00a884; color:#fff; border:none; border-radius:8px; font-size:14px; font-weight:600; cursor:pointer; transition:.2s; }
.input-bar button:hover { background:#008f72; }

/* SETTINGS PANEL */
#settingsPanel { display:none; position:fixed; top:0; right:0; width:400px; height:100vh; background:#111b21; border-left:1px solid #222d34; z-index:100; flex-direction:column; overflow-y:auto; }
#settingsPanel.open { display:flex; }
.settings-header { padding:16px; background:#1f2c34; display:flex; align-items:center; gap:12px; border-bottom:1px solid #222d34; }
.settings-header h3 { font-size:18px; }
.settings-close { background:none; border:none; color:#8696a0; font-size:22px; cursor:pointer; }
.settings-section { padding:16px; border-bottom:1px solid #222d34; }
.settings-section h4 { color:#00a884; font-size:14px; margin-bottom:12px; text-transform:uppercase; letter-spacing:.5px; }
.settings-section label { display:block; color:#8696a0; font-size:13px; margin-bottom:6px; }
.settings-section input[type="text"],
.settings-section textarea { width:100%; padding:10px; background:#2a3942; border:1px solid #374045; border-radius:8px; color:#e9edef; font-size:14px; outline:none; resize:vertical; }
.settings-section textarea { min-height:120px; }
.settings-section input[type="file"] { margin-top:8px; color:#8696a0; }
.settings-btn { padding:10px 20px; background:#00a884; color:#fff; border:none; border-radius:8px; font-size:14px; font-weight:600; cursor:pointer; margin-top:10px; transition:.2s; }
.settings-btn:hover { background:#008f72; }
.settings-btn.danger { background:#ea4335; }
.settings-btn.danger:hover { background:#c5221f; }
.status-msg { padding:8px; border-radius:6px; font-size:13px; margin-top:8px; display:none; }
.status-msg.success { display:block; background:rgba(0,168,132,.15); color:#00a884; }
.status-msg.error { display:block; background:rgba(234,67,53,.15); color:#ea4335; }

.dp-preview { width:100px; height:100px; border-radius:50%; object-fit:cover; background:#2a3942; display:block; margin:8px 0; }

@media (max-width:768px) {
  .sidebar { width:100%; min-width:100%; }
  .chat-area { display:none; }
  .chat-area.active-mobile { display:flex; position:fixed; top:0; left:0; width:100%; height:100%; z-index:50; }
  .messages-area { padding:16px 12px; }
  #settingsPanel { width:100%; }
}
</style>
</head>
<body>

<!-- LOGIN -->
<div id="loginScreen">
  <div class="login-box">
    <h2>💬 WhatsApp Dashboard</h2>
    <p>Login to manage your WhatsApp Business</p>
    <input type="password" id="loginPass" placeholder="Enter password" onkeypress="if(event.key==='Enter')doLogin()">
    <button onclick="doLogin()">Login</button>
    <div class="login-error" id="loginErr">❌ Wrong password</div>
  </div>
</div>

<!-- MAIN APP -->
<div id="app">
  <div class="container">
    <!-- SIDEBAR -->
    <div class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <h3>💬 Chats</h3>
        <div class="header-btns">
          <button class="header-btn" onclick="openSettings()" title="Settings">⚙️</button>
          <button class="header-btn" onclick="loadConversations()" title="Refresh">🔄</button>
        </div>
      </div>
      <div class="search-box">
        <input type="text" id="searchInput" placeholder="🔍 Search contacts..." oninput="filterContacts()">
      </div>
      <div class="contact-list" id="contactList">
        <div style="text-align:center;padding:40px;color:#8696a0">Loading...</div>
      </div>
    </div>

    <!-- CHAT AREA -->
    <div class="chat-area" id="chatArea">
      <div class="empty-chat" id="emptyChat">
        <div class="icon">💬</div>
        <h3>WhatsApp Dashboard</h3>
        <p>Select a conversation to start chatting</p>
      </div>

      <div id="activeChatView" style="display:none;flex-direction:column;height:100%;">
        <div class="chat-header">
          <button class="chat-action-btn" onclick="closeChat()" style="display:none" id="backBtn">⬅️</button>
          <div class="chat-header-avatar" id="chatAvatar">?</div>
          <div>
            <div class="chat-header-name" id="chatName">Name</div>
            <div class="chat-header-phone" id="chatPhone">+91...</div>
          </div>
          <div class="chat-header-actions">
            <button class="chat-action-btn danger" onclick="deleteChat()" title="Delete & Reset">🗑️</button>
          </div>
        </div>
        <div class="messages-area" id="messagesArea"></div>
        <div class="input-bar">
          <input type="text" id="msgInput" placeholder="Type a message..." onkeypress="if(event.key==='Enter')sendMsg()">
          <button onclick="sendMsg()">Send ➤</button>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- SETTINGS PANEL -->
<div id="settingsPanel">
  <div class="settings-header">
    <button class="settings-close" onclick="closeSettings()">✕</button>
    <h3>Settings</h3>
  </div>

  <div class="settings-section">
    <h4>📷 Profile Picture</h4>
    <img id="dpPreview" class="dp-preview" src="" alt="DP">
    <input type="file" id="dpFile" accept="image/jpeg,image/png">
    <button class="settings-btn" onclick="updateDP()">Upload DP</button>
    <div class="status-msg" id="dpStatus"></div>
  </div>

  <div class="settings-section">
    <h4>📝 Profile Info</h4>
    <label>About</label>
    <input type="text" id="profileAbout" placeholder="Hey there! I am using WhatsApp">
    <label style="margin-top:8px">Description</label>
    <textarea id="profileDesc" placeholder="Business description..."></textarea>
    <button class="settings-btn" onclick="updateProfile()">Save Profile</button>
    <div class="status-msg" id="profileStatus"></div>
  </div>

  <div class="settings-section">
    <h4>🤖 Auto-Reply Message</h4>
    <textarea id="autoReplyMsg" placeholder="Auto reply message..."></textarea>
    <p style="font-size:12px;color:#8696a0;margin-top:4px">Use \\n for new line</p>
    <button class="settings-btn" onclick="updateAutoReply()">Save Auto-Reply</button>
    <div class="status-msg" id="arStatus"></div>
  </div>
</div>

<script>
let TOKEN = "";
let currentPhone = "";
let conversations = [];
let pollInterval = null;

// ---- LOGIN ----
function doLogin() {
  const pass = document.getElementById("loginPass").value;
  TOKEN = pass;
  fetch("/api/conversations?token=" + pass)
    .then(r => { if(!r.ok) throw new Error(); return r.json(); })
    .then(() => {
      document.getElementById("loginScreen").style.display = "none";
      document.getElementById("app").style.display = "block";
      loadConversations();
      loadProfile();
      loadAutoReply();
      // Poll every 3 seconds
      pollInterval = setInterval(() => {
        loadConversations();
        if(currentPhone) loadMessages(currentPhone, true);
      }, 3000);
    })
    .catch(() => {
      document.getElementById("loginErr").style.display = "block";
    });
}

function api(url, opts = {}) {
  opts.headers = { ...opts.headers, "x-auth-token": TOKEN };
  return fetch(url, opts);
}

// ---- CONVERSATIONS ----
function loadConversations() {
  api("/api/conversations").then(r => r.json()).then(data => {
    conversations = data;
    renderContacts(data);
  });
}

function renderContacts(data) {
  const el = document.getElementById("contactList");
  if(!data.length) { el.innerHTML = '<div style="text-align:center;padding:40px;color:#8696a0">No conversations yet</div>'; return; }
  
  const search = document.getElementById("searchInput").value.toLowerCase();
  const filtered = search ? data.filter(c => c.name.toLowerCase().includes(search) || c.phone.includes(search)) : data;
  
  el.innerHTML = filtered.map(c => {
    const initials = (c.name || "?")[0].toUpperCase();
    const time = c.lastTime ? new Date(c.lastTime).toLocaleTimeString("en-IN", {hour:"2-digit",minute:"2-digit"}) : "";
    const active = c.phone === currentPhone ? "active" : "";
    const lastMsg = c.lastMessage.length > 40 ? c.lastMessage.substring(0,40) + "..." : c.lastMessage;
    return \`<div class="contact-item \${active}" onclick="openChat('\${c.phone}','\${(c.name||"").replace(/'/g,"\\\\'")}')">
      <div class="contact-avatar">\${initials}</div>
      <div class="contact-info">
        <div class="contact-name">\${c.name || c.phone}</div>
        <div class="contact-last">\${lastMsg}</div>
      </div>
      <span class="contact-time">\${time}</span>
    </div>\`;
  }).join("");
}

function filterContacts() { renderContacts(conversations); }

// ---- CHAT ----
function openChat(phone, name) {
  currentPhone = phone;
  document.getElementById("emptyChat").style.display = "none";
  document.getElementById("activeChatView").style.display = "flex";
  document.getElementById("chatName").textContent = name || phone;
  document.getElementById("chatPhone").textContent = "+" + phone;
  document.getElementById("chatAvatar").textContent = (name || "?")[0].toUpperCase();
  
  // Mobile: show chat
  document.getElementById("chatArea").classList.add("active-mobile");
  document.getElementById("backBtn").style.display = window.innerWidth <= 768 ? "block" : "none";
  
  loadMessages(phone);
  renderContacts(conversations);
}

function closeChat() {
  document.getElementById("chatArea").classList.remove("active-mobile");
  currentPhone = "";
}

function loadMessages(phone, silent) {
  api("/api/messages/" + phone).then(r => r.json()).then(data => {
    const el = document.getElementById("messagesArea");
    const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    
    let html = "";
    let lastDay = "";
    (data.msgs || []).forEach(m => {
      const d = new Date(m.ts);
      const day = d.toLocaleDateString("en-IN", {day:"numeric",month:"short",year:"numeric"});
      if(day !== lastDay) { html += \`<div class="msg-day"><span>\${day}</span></div>\`; lastDay = day; }
      const time = d.toLocaleTimeString("en-IN", {hour:"2-digit",minute:"2-digit"});
      const cls = m.dir === "in" ? "msg-in" : "msg-out";
      html += \`<div class="msg-bubble \${cls}">\${m.text.replace(/\\n/g,"<br>")}<div class="msg-time">\${time}</div></div>\`;
    });
    
    el.innerHTML = html + '<div style="clear:both"></div>';
    if(!silent || wasAtBottom) el.scrollTop = el.scrollHeight;
  });
}

function sendMsg() {
  const input = document.getElementById("msgInput");
  const msg = input.value.trim();
  if(!msg || !currentPhone) return;
  input.value = "";
  
  api("/api/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: currentPhone, message: msg })
  }).then(r => r.json()).then(() => {
    loadMessages(currentPhone);
    loadConversations();
  });
}

function deleteChat() {
  if(!currentPhone) return;
  if(!confirm("Delete conversation and reset auto-reply for this contact?")) return;
  api("/api/customer/" + currentPhone, { method: "DELETE" }).then(() => {
    currentPhone = "";
    document.getElementById("activeChatView").style.display = "none";
    document.getElementById("emptyChat").style.display = "flex";
    loadConversations();
  });
}

// ---- SETTINGS ----
function openSettings() { document.getElementById("settingsPanel").classList.add("open"); }
function closeSettings() { document.getElementById("settingsPanel").classList.remove("open"); }

function loadProfile() {
  api("/api/profile").then(r => r.json()).then(data => {
    if(data.profile_picture_url) document.getElementById("dpPreview").src = data.profile_picture_url;
    if(data.about) document.getElementById("profileAbout").value = data.about;
    if(data.description) document.getElementById("profileDesc").value = data.description;
  }).catch(() => {});
}

function loadAutoReply() {
  api("/api/auto-reply").then(r => r.json()).then(data => {
    document.getElementById("autoReplyMsg").value = data.message || "";
  });
}

function updateDP() {
  const file = document.getElementById("dpFile").files[0];
  if(!file) return alert("Select a photo first!");
  const fd = new FormData();
  fd.append("photo", file);
  showStatus("dpStatus", "Uploading...", "success");
  api("/api/profile/picture", { method: "POST", body: fd })
    .then(r => r.json()).then(data => {
      if(data.success) { showStatus("dpStatus", "✅ DP Updated!", "success"); loadProfile(); }
      else showStatus("dpStatus", "❌ " + (data.error || "Failed"), "error");
    }).catch(() => showStatus("dpStatus", "❌ Upload failed", "error"));
}

function updateProfile() {
  const about = document.getElementById("profileAbout").value;
  const desc = document.getElementById("profileDesc").value;
  api("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ about, description: desc })
  }).then(r => r.json()).then(data => {
    if(data.success) showStatus("profileStatus", "✅ Profile saved!", "success");
    else showStatus("profileStatus", "❌ " + (data.error || "Failed"), "error");
  });
}

function updateAutoReply() {
  const msg = document.getElementById("autoReplyMsg").value;
  api("/api/auto-reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: msg })
  }).then(r => r.json()).then(data => {
    if(data.success) showStatus("arStatus", "✅ Auto-reply updated!", "success");
    else showStatus("arStatus", "❌ Failed", "error");
  });
}

function showStatus(id, msg, type) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = "status-msg " + type;
  setTimeout(() => el.className = "status-msg", 4000);
}
</script>
</body>
</html>`);
});

// ---- START SERVER ----
app.listen(PORT, () => {
  console.log(\`
╔═══════════════════════════════════════════════╗
║   WhatsApp Auto-Reply + Live Chat Dashboard   ║
║   🟢 Server running on port \${PORT}              ║
║   📋 \${Object.keys(customers).length} customers in database            ║
║   💬 \${Object.keys(messages).length} conversations stored             ║
║   🛡️ Max \${MAX_REPLIES_PER_MINUTE} replies/minute                  ║
║   🌐 Dashboard: /chat                        ║
╚═══════════════════════════════════════════════╝
  \`);
});
