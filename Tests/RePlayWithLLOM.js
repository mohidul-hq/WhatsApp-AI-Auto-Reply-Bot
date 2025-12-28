const { Client, LocalAuth } = require('whatsapp-web.js');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const { spawn } = require('child_process');

// Initialize the WhatsApp client with local authentication
const client = new Client({
    authStrategy: new LocalAuth()
});

// List of authorized admin numbers
const authorizedNumbers = ['917864987971', '919531976493'];
let autoReplyEnabled = true; // ✅ Enabled by default

// Queue to process messages in FIFO order
const messageQueue = [];

// Flag to indicate if a message is currently being processed
let isProcessing = false;

// Helper function to log messages with timestamps
function logWithTime(text) {
    console.log(`[${new Date().toLocaleTimeString()}] ${text}`);
}

// Function to build the AI prompt
function buildPrompt(senderName, incomingMessage) {
    return `
    You're a teenage boy Mohidul whatsappp assistant. Reply in Hinglish (Hindi in English script) in a short, casual, and friendly WhatsApp style. Match tone to sender's gender from their name. Avoid AI, bots, personal info, religion, region, or politics. Message from ${senderName}: "${incomingMessage}"

 `;
}

// Generate AI reply using the local LLM
async function generateAIReply(senderName, incomingMessage) {
    try {
        const prompt = buildPrompt(senderName, incomingMessage);
        const response = await axios.post('http://localhost:11434/api/generate', {
            model: 'mistral',
            prompt,
            stream: false
        });

        return response?.data?.response?.trim() || null;
    } catch (error) {
        console.error('[AI Error]', error.message);
        return null;
    }
}

// Default reply if AI fails
function generateDefaultReply(senderName) {
    return `Hi ${senderName}, I'm a bit busy right now. Will ping you soon! 😊`;
}

// Process message queue
async function processQueue() {
    if (isProcessing || messageQueue.length === 0) return;

    isProcessing = true;
    const { message, contact } = messageQueue.shift();
    const senderName = contact.pushname || contact.number;

    // Delay randomly (1s to 45s)
    const delay = Math.floor(Math.random() * 45000) + 1000;
    setTimeout(async () => {
        await message.getChat().then(chat => chat.sendSeen());
        logWithTime(`👀 Marked as read: ${message.body}`);

        const chat = await message.getChat();
        await chat.sendStateTyping();

        const replyText = await generateAIReply(senderName, message.body) || generateDefaultReply(senderName);

        await chat.clearState();
        await message.reply(replyText);
        logWithTime(`📤 to ${senderName}: ${replyText}`);

        isProcessing = false;
        processQueue();
    }, delay);
}

// Handle incoming messages
client.on('message', async message => {
    if (message.fromMe) return;
    if (message.isStatus) {
        logWithTime('📵 Ignored status message.');
        return;
    }

    logWithTime(`📨 Received: ${message.body}`);

    const contact = await message.getContact();
    const senderNumber = contact.number.replace(/[^0-9]/g, '');
    const command = message.body.trim().toLowerCase();
    const isAuthorized = authorizedNumbers.includes(senderNumber);

    // Handle admin commands
    if (isAuthorized) {
        switch (command) {
            case '!enable':
                autoReplyEnabled = true;
                await message.reply('Auto-reply ✅');
                logWithTime(`Enabled via ${contact.pushname || contact.number}`);
                return;
            case '!disable':
                autoReplyEnabled = false;
                await message.reply('Auto-reply ❌');
                logWithTime(`Disabled via ${contact.pushname || contact.number}`);
                return;
            case '!status':
                const status = autoReplyEnabled ? '✅' : '❌';
                await message.reply(`Auto-reply is currently ${status}.`);
                return;
        }
    }

    if (command === 'help') {
        await message.reply(`
*Admin Commands:*
!enable - Enable auto-reply
!disable - Disable auto-reply
!status - Check auto-reply status
help - Display this help

⚠ *Only Admins can control auto-reply*
        `);
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

// QR Code display
client.on('qr', (qr) => {
    console.log('QR Code Received: 👇');
    qrcode.generate(qr, { small: true });
});

// On client ready
client.on('ready', () => {
    console.log(`🤖 Bot is ready!`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('👋 Gracefully shutting down...');
    client.destroy();
    process.exit();
});

// Error handling & auto-restart
process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err);
    restartProgram();
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    restartProgram();
});

function restartProgram() {
    logWithTime('🔁 Restarting bot due to unexpected error...');
    spawn(process.argv[0], process.argv.slice(1), {
        stdio: 'inherit'
    });
    process.exit(1);
}

// Initialize
client.initialize();
