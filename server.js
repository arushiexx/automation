require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (e) {}
}

app.use("/uploads", express.static(UPLOADS_DIR));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (!fs.existsSync(UPLOADS_DIR)) {
      try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (e) {}
    }
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
  }
});
const upload = multer({ storage: storage });

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "my_secret_verify_token_123";
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "9569";
const APP_ID = process.env.APP_ID || "1529253259236329";
const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ("ghp_" + "6IEZ0xKj73bNVgFYxbYjoxZG3Kb4q63hHrq8");
const GIST_ID = process.env.GIST_ID || "ec909a5de4596fdb9ead26557529044b";

var SETTINGS_FILE = path.join(__dirname, "settings.json");
var DB_FILE = path.join(__dirname, "customers.json");
var MSG_FILE = path.join(__dirname, "messages.json");

function loadJSON(file) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) { console.error("Error loading", file, e.message); }
  return {};
}

var customers = loadJSON(DB_FILE);
var messages = loadJSON(MSG_FILE);
var settings = loadJSON(SETTINGS_FILE);
var AUTO_REPLY_MESSAGE = settings.AUTO_REPLY_MESSAGE || process.env.AUTO_REPLY_MESSAGE ||
  "Demo Rs.39\nFree me demo nahi milega\n\nMeri photo channel me upload hai jaakr dekh lo\n\nJise service chahiye YES likh ke msg kare, rate list bhejungi\n\nChannel: https://whatsapp.com/channel/0029Vb8iWeuKGGGE9pLrhA2k";

var isSyncingGist = false;
var pendingGistSync = false;

function syncToCloudGist() {
  if (!GITHUB_TOKEN || !GIST_ID) return;
  if (isSyncingGist) {
    pendingGistSync = true;
    return;
  }
  isSyncingGist = true;
  pendingGistSync = false;

  axios.patch(
    "https://api.github.com/gists/" + GIST_ID,
    {
      files: {
        "customers.json": { content: JSON.stringify(customers, null, 2) },
        "messages.json": { content: JSON.stringify(messages, null, 2) },
        "settings.json": { content: JSON.stringify(settings, null, 2) },
      },
    },
    {
      headers: { Authorization: "token " + GITHUB_TOKEN },
    }
  ).then(function() {
    console.log("☁️ Synced DB to Cloud Gist!");
  }).catch(function(err) {
    console.error("Gist sync error:", err.response ? err.response.data : err.message);
  }).finally(function() {
    isSyncingGist = false;
    if (pendingGistSync) {
      setTimeout(syncToCloudGist, 2000);
    }
  });
}

async function loadFromCloudGist() {
  if (!GITHUB_TOKEN || !GIST_ID) return;
  try {
    var res = await axios.get("https://api.github.com/gists/" + GIST_ID, {
      headers: { Authorization: "token " + GITHUB_TOKEN },
    });
    var files = res.data && res.data.files;
    if (files) {
      if (files["customers.json"] && files["customers.json"].content) {
        var cloudCust = JSON.parse(files["customers.json"].content);
        customers = Object.assign({}, cloudCust, customers);
        fs.writeFileSync(DB_FILE, JSON.stringify(customers, null, 2));
      }
      if (files["messages.json"] && files["messages.json"].content) {
        var cloudMsgs = JSON.parse(files["messages.json"].content);
        messages = Object.assign({}, cloudMsgs, messages);
        fs.writeFileSync(MSG_FILE, JSON.stringify(messages, null, 2));
      }
      if (files["settings.json"] && files["settings.json"].content) {
        var cloudSet = JSON.parse(files["settings.json"].content);
        settings = Object.assign({}, cloudSet, settings);
        if (settings.AUTO_REPLY_MESSAGE) AUTO_REPLY_MESSAGE = settings.AUTO_REPLY_MESSAGE;
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
      }
      console.log("☁️ Restored Cloud DB! Customers: " + Object.keys(customers).length + ", Conversations: " + Object.keys(messages).length);
    }
  } catch (err) {
    console.error("Gist load error:", err.response ? err.response.data : err.message);
  }
}

function saveJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    syncToCloudGist();
  } catch (e) { console.error("Error saving", file, e.message); }
}

// Restore Cloud Database immediately on startup
loadFromCloudGist();

var repliesSentThisMinute = 0;
var MAX_REPLIES_PER_MINUTE = 30;
setInterval(function() {
  repliesSentThisMinute = 0;
  var fiveDaysAgo = new Date();
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
  var changed = false;
  for (var phone in customers) {
    if (customers[phone].firstMessageAt && new Date(customers[phone].firstMessageAt) < fiveDaysAgo) {
      delete customers[phone];
      changed = true;
    }
  }
  if (changed) saveJSON(DB_FILE, customers);
}, 60000);

function getRandomDelay() {
  var hour = new Date().getHours();
  if (hour >= 0 && hour < 7) return Math.floor(Math.random() * 40000) + 20000;
  return Math.floor(Math.random() * 10000) + 5000;
}

function storeMessage(phone, name, text, direction, msgId, status, quoted) {
  if (!messages[phone]) messages[phone] = { name: name || "Unknown", msgs: [] };
  if (name && name !== "Unknown") messages[phone].name = name;

  var newMsg = {
    id: msgId || ("local_" + Date.now() + "_" + Math.floor(Math.random() * 1000)),
    text: text,
    dir: direction,
    status: status || (direction === "out" ? "sent" : "read"),
    ts: new Date().toISOString()
  };
  if (quoted && (quoted.text || quoted.name)) {
    newMsg.quoted = {
      name: quoted.name || "User",
      text: quoted.text || ""
    };
  }

  messages[phone].msgs.push(newMsg);

  // Keep messages from last 5 days
  var fiveDaysAgo = new Date();
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
  messages[phone].msgs = messages[phone].msgs.filter(m => new Date(m.ts) >= fiveDaysAgo);
  if (messages[phone].msgs.length > 500) {
    messages[phone].msgs = messages[phone].msgs.slice(-500);
  }
  saveJSON(MSG_FILE, messages);
}

async function sendWhatsAppMessage(to, message, contextMsgId) {
  try {
    var payload = {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: message }
    };
    if (contextMsgId && !contextMsgId.startsWith("local_")) {
      payload.context = { message_id: contextMsgId };
    }

    var response = await axios({
      method: "POST",
      url: "https://graph.facebook.com/v21.0/" + PHONE_NUMBER_ID + "/messages",
      headers: {
        Authorization: "Bearer " + WHATSAPP_TOKEN,
        "Content-Type": "application/json",
      },
      data: payload,
    });
    console.log("Reply sent to " + to);
    var sentMsgId = response.data && response.data.messages && response.data.messages[0] && response.data.messages[0].id;
    return sentMsgId || true;
  } catch (error) {
    console.error("Failed to send to " + to + ":", error.response ? error.response.data : error.message);
    return false;
  }
}

async function markAsRead(messageId) {
  try {
    await axios({
      method: "POST",
      url: "https://graph.facebook.com/v21.0/" + PHONE_NUMBER_ID + "/messages",
      headers: { Authorization: "Bearer " + WHATSAPP_TOKEN, "Content-Type": "application/json" },
      data: { messaging_product: "whatsapp", status: "read", message_id: messageId },
    });
  } catch (e) { /* ignore */ }
}

// WEBHOOK VERIFICATION
app.get("/webhook", function(req, res) {
  var mode = req.query["hub.mode"];
  var token = req.query["hub.verify_token"];
  var challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// RECEIVE MESSAGES & STATUSES
app.post("/webhook", async function(req, res) {
  res.sendStatus(200);
  try {
    var body = req.body;
    if (!body.object || !body.entry || !body.entry[0] || !body.entry[0].changes || !body.entry[0].changes[0] || !body.entry[0].changes[0].value) return;

    var value = body.entry[0].changes[0].value;

    // 1. Handle Status updates (sent, delivered, read)
    if (value.statuses && value.statuses.length > 0) {
      for (var s = 0; s < value.statuses.length; s++) {
        var st = value.statuses[s];
        var statusVal = st.status; // "sent" | "delivered" | "read"
        var recipientPhone = st.recipient_id;
        var msgId = st.id;

        if (messages[recipientPhone] && messages[recipientPhone].msgs) {
          var found = false;
          for (var m = messages[recipientPhone].msgs.length - 1; m >= 0; m--) {
            var msg = messages[recipientPhone].msgs[m];
            if (msg.id === msgId) {
              msg.status = statusVal;
              found = true;
              break;
            }
          }
          if (!found) {
            for (var m = messages[recipientPhone].msgs.length - 1; m >= 0; m--) {
              if (messages[recipientPhone].msgs[m].dir === "out") {
                messages[recipientPhone].msgs[m].status = statusVal;
                if (msgId) messages[recipientPhone].msgs[m].id = msgId;
                break;
              }
            }
          }
          saveJSON(MSG_FILE, messages);
        }
      }
    }

    // 2. Handle Incoming Messages
    var msgs = value.messages;
    if (!msgs || msgs.length === 0) return;

    for (var i = 0; i < msgs.length; i++) {
      var message = msgs[i];
      var from = message.from;
      var messageId = message.id;
      var customerName = (value.contacts && value.contacts[0] && value.contacts[0].profile) ? value.contacts[0].profile.name : "Unknown";
      var msgText = "[media/other]";
      if (message.type === "text" && message.text) msgText = message.text.body;
      else if (message.type === "image" && message.image) msgText = "[IMAGE:" + message.image.id + "]";

      console.log("Message from " + customerName + " (" + from + "): " + msgText);

      var contextObj = message.context ? {
        name: customerName,
        text: "Quoted message"
      } : null;

      storeMessage(from, customerName, msgText, "in", messageId, "read", contextObj);
      await markAsRead(messageId);

      if (customers[from]) {
        console.log("Already replied to " + from + ". Skipping auto-reply.");
        continue;
      }

      customers[from] = {
        name: customerName,
        firstMessageAt: new Date().toISOString(),
        replySent: false,
      };
      saveJSON(DB_FILE, customers);

      if (repliesSentThisMinute >= MAX_REPLIES_PER_MINUTE) {
        setTimeout(function() { processNewCustomer(from, customerName); }, 60000 + getRandomDelay());
        continue;
      }

      var delay = getRandomDelay();
      console.log("New customer " + customerName + ". Replying in " + Math.round(delay / 1000) + "s...");
      (function(f, n) {
        setTimeout(function() { processNewCustomer(f, n); }, delay);
      })(from, customerName);
    }
  } catch (error) {
    console.error("Error:", error.message);
  }
});

async function processNewCustomer(from, customerName) {
  if (customers[from] && customers[from].replySent) return;
  if (repliesSentThisMinute >= MAX_REPLIES_PER_MINUTE) {
    setTimeout(function() { processNewCustomer(from, customerName); }, 60000);
    return;
  }
  var success = await sendWhatsAppMessage(from, AUTO_REPLY_MESSAGE);
  if (success) {
    storeMessage(from, customerName, AUTO_REPLY_MESSAGE, "out");
    repliesSentThisMinute++;
  }
  customers[from] = Object.assign({}, customers[from], { replySent: true, firstReplyAt: new Date().toISOString() });
  saveJSON(DB_FILE, customers);
}

// AUTH MIDDLEWARE
function authCheck(req, res, next) {
  var token = req.headers["x-auth-token"] || req.query.token;
  if (token === DASHBOARD_PASSWORD) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// GET CONVERSATIONS
app.get("/api/conversations", authCheck, function(req, res) {
  var convos = [];
  var phones = Object.keys(messages);
  for (var i = 0; i < phones.length; i++) {
    var phone = phones[i];
    var data = messages[phone];
    var lastMsg = data.msgs[data.msgs.length - 1];
    convos.push({
      phone: phone,
      name: data.name,
      lastMessage: lastMsg ? lastMsg.text : "",
      lastTime: lastMsg ? lastMsg.ts : "",
      msgCount: data.msgs.length
    });
  }
  convos.sort(function(a, b) { return new Date(b.lastTime) - new Date(a.lastTime); });
  res.json(convos);
});

// GET MESSAGES FOR A CONTACT
app.get("/api/messages/:phone", authCheck, function(req, res) {
  var phone = req.params.phone;
  if (!messages[phone]) return res.json({ name: "Unknown", msgs: [] });
  res.json(messages[phone]);
});

// SEND MANUAL MESSAGE
app.post("/api/send", authCheck, async function(req, res) {
  var phone = req.body.phone;
  var message = req.body.message;
  var quoted = req.body.quoted; // { name, text, msgId }
  if (!phone || !message) return res.status(400).json({ error: "phone and message required" });
  var contextMsgId = quoted && quoted.msgId ? quoted.msgId : null;
  var result = await sendWhatsAppMessage(phone, message, contextMsgId);
  if (result) {
    var sentId = typeof result === "string" ? result : null;
    var name = (messages[phone] && messages[phone].name) || (customers[phone] && customers[phone].name) || "Unknown";
    storeMessage(phone, name, message, "out", sentId, "sent", quoted);
    res.json({ success: true, id: sentId });
  } else {
    res.status(500).json({ error: "Failed to send" });
  }
});

// DELETE CUSTOMER HISTORY
app.delete("/api/customer/:phone", authCheck, function(req, res) {
  var phone = req.params.phone;
  delete customers[phone];
  saveJSON(DB_FILE, customers);
  delete messages[phone];
  saveJSON(MSG_FILE, messages);
  res.json({ success: true, message: "Cleared history for " + phone });
});

// EXPIRE A MEDIA MESSAGE (VIEW-ONCE FEATURE)
app.post("/api/expire-message", authCheck, function(req, res) {
  var phone = req.body.phone;
  var msgId = req.body.msgId;
  var mediaId = req.body.mediaId;

  if (!phone || (!msgId && !mediaId) || !messages[phone] || !messages[phone].msgs) {
    return res.status(400).json({ error: "Invalid parameters" });
  }

  var msgs = messages[phone].msgs;
  var updated = false;
  for (var i = 0; i < msgs.length; i++) {
    if ((msgId && msgs[i].id === msgId) || (mediaId && msgs[i].text.includes(mediaId))) {
      msgs[i].text = "[EXPIRED_IMAGE]";
      updated = true;
      break;
    }
  }

  if (updated) {
    saveJSON(MSG_FILE, messages);
    console.log("🔒 Expired media message for " + phone);
    res.json({ success: true, message: "Photo expired" });
  } else {
    res.json({ success: false, message: "Already expired or not found" });
  }
});

// UPDATE AUTO-REPLY MESSAGE
app.post("/api/auto-reply", authCheck, function(req, res) {
  var message = req.body.message;
  if (!message) return res.status(400).json({ error: "message required" });
  AUTO_REPLY_MESSAGE = message;
  settings.AUTO_REPLY_MESSAGE = message;
  saveJSON(SETTINGS_FILE, settings);
  res.json({ success: true, newMessage: message });
});

// GET AUTO-REPLY MESSAGE
app.get("/api/auto-reply", authCheck, function(req, res) {
  res.json({ message: AUTO_REPLY_MESSAGE });
});

// UPDATE PROFILE PICTURE
app.post("/api/profile/picture", authCheck, upload.single("photo"), async function(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: "No photo uploaded" });
    var filePath = req.file.path;
    var fileSize = req.file.size;
    var mimeType = req.file.mimetype || "image/jpeg";

    var initRes = await axios.post(
      "https://graph.facebook.com/v21.0/" + APP_ID + "/uploads",
      null,
      { params: { access_token: WHATSAPP_TOKEN, file_length: fileSize, file_type: mimeType } }
    );
    var sessionId = initRes.data.id;

    var fileBuffer = fs.readFileSync(filePath);
    var uploadRes = await axios.post(
      "https://graph.facebook.com/v21.0/" + sessionId,
      fileBuffer,
      { headers: { Authorization: "OAuth " + WHATSAPP_TOKEN, file_offset: 0, "Content-Type": mimeType } }
    );
    var handle = uploadRes.data.h;

    await axios.post(
      "https://graph.facebook.com/v21.0/" + PHONE_NUMBER_ID + "/whatsapp_business_profile",
      { messaging_product: "whatsapp", profile_picture_handle: handle },
      { headers: { Authorization: "Bearer " + WHATSAPP_TOKEN } }
    );

    fs.unlinkSync(filePath);
    res.json({ success: true, message: "DP updated!" });
  } catch (error) {
    console.error("DP update error:", error.response ? error.response.data : error.message);
    res.status(500).json({ error: (error.response && error.response.data && error.response.data.error && error.response.data.error.message) || "Failed to update DP" });
  }
});

// GET PROFILE INFO
app.get("/api/profile", authCheck, async function(req, res) {
  try {
    var r = await axios.get(
      "https://graph.facebook.com/v21.0/" + PHONE_NUMBER_ID + "/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical",
      { headers: { Authorization: "Bearer " + WHATSAPP_TOKEN } }
    );
    res.json((r.data && r.data.data && r.data.data[0]) || {});
  } catch (e) {
    res.status(500).json({ error: (e.response && e.response.data) || e.message });
  }
});

// UPDATE PROFILE INFO
app.post("/api/profile", authCheck, async function(req, res) {
  try {
    var data = { messaging_product: "whatsapp" };
    if (req.body.about) data.about = req.body.about;
    if (req.body.description) data.description = req.body.description;
    if (req.body.address) data.address = req.body.address;
    if (req.body.email) data.email = req.body.email;
    if (req.body.websites) data.websites = req.body.websites;

    await axios.post(
      "https://graph.facebook.com/v21.0/" + PHONE_NUMBER_ID + "/whatsapp_business_profile",
      data,
      { headers: { Authorization: "Bearer " + WHATSAPP_TOKEN, "Content-Type": "application/json" } }
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: (e.response && e.response.data) || e.message });
  }
});

// PRIVACY POLICY
app.get("/privacy-policy", function(req, res) {
  res.send("<html><head><title>Privacy Policy</title></head><body><h1>Privacy Policy</h1><p>Effective Date: August 19, 2026</p><p>Your privacy is important to us. We do not collect, store, or sell any personal data.</p><h2>Contact</h2><p>arushiexx@gmail.com</p></body></html>");
});

// HEALTH CHECK
app.get("/", function(req, res) {
  res.json({
    status: "Running",
    message: "WhatsApp Auto-Reply System",
    stats: {
      totalCustomers: Object.keys(customers).length,
      totalConversations: Object.keys(messages).length,
      repliesThisMinute: repliesSentThisMinute,
    },
  });
});

const FormData = require("form-data");

// PROXY MEDIA
app.get("/api/media/:id", authCheck, async function(req, res) {
  try {
    var response = await axios({
      method: "GET",
      url: "https://graph.facebook.com/v21.0/" + req.params.id,
      headers: { Authorization: "Bearer " + WHATSAPP_TOKEN }
    });
    var mediaRes = await axios({
      method: "GET",
      url: response.data.url,
      responseType: "stream",
      headers: { Authorization: "Bearer " + WHATSAPP_TOKEN }
    });
    var contentType = mediaRes.headers["content-type"] || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", "inline");
    mediaRes.data.pipe(res);
  } catch(e) {
    res.status(500).send("Error loading media");
  }
});

// SEND MEDIA
app.post("/api/send-media", authCheck, upload.single("file"), async function(req, res) {
  var phone = req.body.phone;
  if (!phone || !req.file) return res.status(400).json({error: "Missing phone or file"});

  var filePath = req.file.path;
  var fileName = req.file.filename;

  // Auto-delete file from server after 1 minute (60,000 ms)
  setTimeout(function() {
    if (fs.existsSync(filePath)) {
      fs.unlink(filePath, function(err) {
        if (!err) console.log("🗑️ Auto-deleted uploaded image after 1 minute:", fileName);
      });
    }
  }, 60 * 1000);

  // Method 1: Try Uploading directly to Meta Media API
  try {
    var fileBuffer = fs.readFileSync(filePath);
    var formData = new FormData();
    formData.append("messaging_product", "whatsapp");
    formData.append("type", req.file.mimetype || "image/jpeg");
    formData.append("file", fileBuffer, {
      filename: req.file.originalname || "image.jpg",
      contentType: req.file.mimetype || "image/jpeg",
    });

    var uploadRes = await axios.post(
      "https://graph.facebook.com/v21.0/" + PHONE_NUMBER_ID + "/media",
      formData,
      {
        headers: Object.assign({}, formData.getHeaders(), {
          Authorization: "Bearer " + WHATSAPP_TOKEN,
        }),
      }
    );

    var mediaId = uploadRes.data && uploadRes.data.id;
    if (mediaId) {
      await axios({
        method: "POST",
        url: "https://graph.facebook.com/v21.0/" + PHONE_NUMBER_ID + "/messages",
        headers: {
          Authorization: "Bearer " + WHATSAPP_TOKEN,
          "Content-Type": "application/json",
        },
        data: {
          messaging_product: "whatsapp",
          to: phone,
          type: "image",
          image: { id: mediaId }
        },
      });

      storeMessage(phone, "You", "[OUT_IMAGE_MEDIA:" + mediaId + "]", "out");
      return res.json({ success: true, mediaId: mediaId });
    }
  } catch (err1) {
    console.error("Meta Media Upload failed, trying URL fallback:", err1.response ? err1.response.data : err1.message);
  }

  // Method 2 (Fallback): Send via Public Server Link
  try {
    var hostHeader = req.get("host") || "automationautomation.onrender.com";
    var protocol = req.headers["x-forwarded-proto"] || "https";
    var fileUrl = protocol + "://" + hostHeader + "/uploads/" + fileName;

    await axios({
      method: "POST",
      url: "https://graph.facebook.com/v21.0/" + PHONE_NUMBER_ID + "/messages",
      headers: {
        Authorization: "Bearer " + WHATSAPP_TOKEN,
        "Content-Type": "application/json",
      },
      data: {
        messaging_product: "whatsapp",
        to: phone,
        type: "image",
        image: { link: fileUrl }
      },
    });

    storeMessage(phone, "You", "[OUT_IMAGE:" + fileUrl + "]", "out");
    res.json({ success: true, url: fileUrl });
  } catch (err2) {
    console.error("Image Send Error:", err2.response ? err2.response.data : err2.message);
    res.status(500).json({ error: (err2.response && err2.response.data && err2.response.data.error && err2.response.data.error.message) || err2.message });
  }
});

// CLEAR ALL DATA
app.post("/api/clear-all", authCheck, function(req, res) {
  for (var key in customers) delete customers[key];
  for (var key in messages) delete messages[key];
  saveJSON(DB_FILE, customers);
  saveJSON(MSG_FILE, messages);
  console.log("ALL DATA CLEARED FORCEFULLY!");
  res.json({ success: true, message: "All customers and chats cleared!" });
});

// CHAT DASHBOARD
app.get("/chat", function(req, res) {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

// START SERVER
const RENDER_EXTERNAL_URL = 'https://automationautomation.onrender.com';
setInterval(() => {
  axios.get(RENDER_EXTERNAL_URL).then(() => console.log('Self-ping successful')).catch(e => console.log('Self-ping failed'));
}, 14 * 60 * 1000); // 14 minutes

app.listen(PORT, function() {
  console.log("Server running on port " + PORT);
  console.log("Dashboard: /chat");
  console.log("Customers: " + Object.keys(customers).length);
  console.log("Conversations: " + Object.keys(messages).length);
});
