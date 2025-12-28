const { Client, LocalAuth } = require('whatsapp-web.js');
const axios = require('axios');
const qrcode = require('qrcode-terminal');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

const authorizedNumbers = ['917864987971', '919531976493'];
let autoReplyEnabled = true;
const messageQueue = [];
let isProcessing = false;
const chatHistory = new Map();

const CHAT_API_KEY = 'sk-pyyW1pClCVlFK3TP7pwOWNVDsutzUGNXp39h7gi7eYAaH8a1';
const BASE_URL = 'https://api.chatanywhere.tech/v1';
const MODEL = 'gpt-4.1-mini';

const lastMessageTimestamps = new Map();

function logWithTime(text) {
    console.log(`[${new Date().toLocaleTimeString()}] ${text}`);
}

function buildPrompt(senderName, incomingMessage, history = []) {
    const contextMessages = history.slice(-3).map((msg, i) => `Prev msg ${i + 1}: ${msg}`).join('\n');
    return `
You're Mohidul, a chill teenage Indian boy acting as a friendly WhatsApp assistant. Speak like a real desi teenager in casual Hinglish or Banglish (mix Hindi, Bengali, and English in roman script). Keep replies short, chill, funny or romantic (if needed), and always in WhatsApp-style — just like you're texting a friend. Avoid sounding robotic or formal.

Incoming message from ${senderName}: "${incomingMessage}"

${contextMessages ? contextMessages + '\n' : ''}

Rules:
1. Detect gender from name (e.g., Priya = female, Rahul = male).
2. If sender is male, use “bhai” or “bhiya”. If female, use “didi” or “yaar” (choose based on tone).
3. If name seems foreign or unknown, keep it neutral (no “bhai/didi”).
4. Never mention AI, bots, religion, politics, WhatsApp assistant or personal details.
5. Act like a smart, friendly teenage boy. Use Hinglish/Banglish, emojis, and slang. Be funny, chill, and relatable, romantic if needed.
6. Keep reply WhatsApp-style — 1-line reply unless something needs extra info. No long paragraphs.
7. Always sound human — like you're really typing and vibing with them.
8. If name is abdul hanif reply respectfully and he is my bhiya.

Examples of your tone:
- "Haan bhai, ek min ruk ja 😎"
- "Ho jayega didi, chill maar 😌"
- "Kamon achish bhai? all good?"

Your reply should feel real — like a chill Indian teen just typing back.`;
}

async function generateAIReply(senderName, senderNumber, incomingMessage) {
    try {
        const history = chatHistory.get(senderNumber) || [];
        const prompt = buildPrompt(senderName, incomingMessage, history);

        const response = await axios.post(`${BASE_URL}/chat/completions`, {
            model: MODEL,
            messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: prompt }
            ]
        }, {
            headers: {
                'Authorization': `Bearer ${CHAT_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        return response?.data?.choices?.[0]?.message?.content?.trim() || null;
    } catch (error) {
        console.error('[API Error]', error.message);
        return null;
    }
}

function generateDefaultReply(senderName) {
    return `Hi ${senderName}, I'm a bit busy right now. Will ping you soon! 😊`;
}

function getTypingDelay(replyText) {
    const words = replyText.split(/\s+/).length;
    return Math.min(8000 + words * 300, 30000);
}

function getSeenDelay(senderNumber) {
    const now = Date.now();
    const lastTimestamp = lastMessageTimestamps.get(senderNumber) || 0;
    const timeSinceLast = now - lastTimestamp;
    lastMessageTimestamps.set(senderNumber, now);

    return timeSinceLast < 30000
        ? Math.floor(Math.random() * 10000) + 3000
        : Math.floor(Math.random() * 30000) + 10000;
}

async function processQueue() {
    if (isProcessing || messageQueue.length === 0) return;
    isProcessing = true;

    const { message, contact } = messageQueue.shift();
    const senderName = contact.pushname || contact.number;
    const senderNumber = contact.number.replace(/\D/g, '');
    const seenDelay = getSeenDelay(senderNumber);

    setTimeout(async () => {
        await message.getChat().then(chat => chat.sendSeen());
        logWithTime(`👀 Seen: ${message.body}`);

        const replyText = await generateAIReply(senderName, senderNumber, message.body) || generateDefaultReply(senderName);
        const chat = await message.getChat();

        await chat.sendStateTyping();
        const typingDelay = getTypingDelay(replyText);
        logWithTime(`⌨️ Typing for ${typingDelay / 1000}s`);

        setTimeout(async () => {
            await chat.clearState();
            await message.reply(replyText);
            logWithTime(`📤 to ${senderName}: ${replyText}`);

            if (!chatHistory.has(senderNumber)) chatHistory.set(senderNumber, []);
            chatHistory.get(senderNumber).push(message.body);

            isProcessing = false;
            processQueue();
        }, typingDelay);
    }, seenDelay);
}

client.on('message', async message => {
    if (message.fromMe || message.isStatus || message.from.includes('@g.us')) {
        logWithTime('📵 Ignored message.');
        return;
    }

    logWithTime(`📨 Received: ${message.body}`);
    const contact = await message.getContact();
    const senderNumber = contact.number.replace(/\D/g, '');
    const command = message.body.trim().toLowerCase();
    const isAuthorized = authorizedNumbers.includes(senderNumber);

    if (isAuthorized) {
        if (command === '!enable') {
            autoReplyEnabled = true;
            await message.reply('Auto-reply ✅');
            logWithTime(`Enabled by ${contact.pushname || contact.number}`);
            return;
        }
        if (command === '!disable') {
            autoReplyEnabled = false;
            await message.reply('Auto-reply ❌');
            logWithTime(`Disabled by ${contact.pushname || contact.number}`);
            return;
        }
        if (command === '!status') {
            await message.reply(`Auto-reply is ${autoReplyEnabled ? '✅ enabled' : '❌ disabled'}.`);
            return;
        }
    }

    if (command === 'help') {
        await message.reply(`*Admin Commands:*
!enable - Enable auto-reply
!disable - Disable auto-reply
!status - Show auto-reply status
help - Show this help

⚠ *Only for Admins*`);
        return;
    }

    if (!autoReplyEnabled) return;

    if (
        message.body.length > 1000 ||
        message.body.toLowerCase().includes('urgent') ||
        message.body.startsWith('http') ||
        message.type !== 'chat'
    ) {
        logWithTime('⚠ Skipped non-standard or flagged message.');
        return;
    }

    messageQueue.push({ message, contact });
    processQueue();
});

client.on('qr', qr => {
    console.log('📲 Scan this QR code to log in:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log(`🤖 is ready and running!`);
});

process.on('SIGINT', () => {
    console.log('👋 Gracefully shutting down...');
    client.destroy();
    process.exit();
});

process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection:', reason);
});

client.initialize();
