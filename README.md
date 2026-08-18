# WhatsApp Auto-Reply System 🤖

Naye customers ko automatic rate card text bhejne ka system.
WhatsApp Business API (Meta Cloud API) use karta hai — **BAN NAHI HOGA!**

## Kya Karta Hai

```
Customer: "Hi" (pehla message)
→ 5-15 sec baad auto reply:

"Demo ₹39
Jise photo dekhna hai channel me jaakr dekh lo 👇

Mai he karungi call 📞
Alag se bhejne ka ₹200

Jise baat karni hai YES likh ke message kare, rate list bhejungi 💕"

Customer dobara message kare → Kuch nahi hoga (ladki khud phone se reply karegi)
```

## Safety Features 🛡️

- ✅ **Random Delay**: 5-15 sec (raat ko 20-60 sec)
- ✅ **One-time Reply**: Sirf pehle message pe
- ✅ **Rate Limiting**: Max 30 replies/minute
- ✅ **Customer Tracking**: Database me save
- ✅ **Night Mode**: Raat ko slow replies

## Setup Guide

### Step 1: Meta Developer Account
1. [developers.facebook.com](https://developers.facebook.com) pe jao
2. Login karo → "Create App" → "Business" type
3. WhatsApp product add karo
4. Phone number add + verify karo
5. Copy karo:
   - **API Token** (Temporary access token)
   - **Phone Number ID** (number ke neeche likha hoga)

### Step 2: .env File Banao
```bash
# .env.example ko copy karo
cp .env.example .env
```

Fir `.env` me ye values daalo:
```
WHATSAPP_TOKEN=paste_your_token_here
PHONE_NUMBER_ID=paste_your_phone_number_id_here
VERIFY_TOKEN=my_secret_verify_token_123
```

### Step 3: Local Test
```bash
npm start
```
Server start hoga port 3000 pe.

### Step 4: Render.com pe Deploy (FREE)
1. GitHub pe push karo ye code
2. [render.com](https://render.com) pe login karo
3. "New Web Service" banao
4. GitHub repo connect karo
5. Settings:
   - Build Command: `npm install`
   - Start Command: `npm start`
6. Environment Variables me `.env` ki values daalo
7. Deploy!

### Step 5: Webhook Connect Karo
1. Render se URL milega: `https://your-app.onrender.com`
2. Meta Developer Portal → WhatsApp → Configuration
3. Webhook URL daalo: `https://your-app.onrender.com/webhook`
4. Verify Token daalo: `my_secret_verify_token_123`
5. Subscribe to: `messages`

### Step 6: Test Karo
Kisi dost se us number pe "Hi" bhejwao. 5-15 sec me auto reply aana chahiye!

## Stats Check
Browser me jaao: `https://your-app.onrender.com/`
Stats dikhenge: total customers, today replies, etc.

## Message Change Karna Hai?
`.env` file me `AUTO_REPLY_MESSAGE` change karo aur server restart karo.
