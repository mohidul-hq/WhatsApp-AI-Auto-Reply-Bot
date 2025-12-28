const { Client, LocalAuth } = require('whatsapp-web.js');
const axios = require('axios');
const qrcode = require('qrcode-terminal');

// Optional: Set your OpenAI API key to generate dynamic responses.
const OPENAI_API_KEY = 'sk-pyyW1pClCVIFK3TP7pWOWNVDsutzUGNXp39h7gi7eYAaH8a1'; // Replace with your API key or leave as an empty string if not using AI.

// Initialize the WhatsApp client with persistent local authentication.
const client = new Client({
    authStrategy: new LocalAuth()
});

// Auto-reply flag – true when auto-reply should be active.
let autoReplyEnabled = false;

// List of authorized numbers who can control the bot (in international format without '+' and without spaces).
const authorizedNumbers = ['917864987971', '919531976493']; // Replace with actual numbers.

// --- WhatsApp Client Events ---

// Display the QR code in the terminal for first-time authentication.
client.on('qr', (qr) => {
    console.log('QR Code Received: 👇');
    qrcode.generate(qr, { small: true });
});

// When the client is ready, log that it's ready.
client.on('ready', () => {
    console.log('Client is ready! ✅');
});

// --- Helper Functions ---

// Function to call OpenAI's API to generate a dynamic reply.
async function generateAIReply(senderName, incomingMessage) {
    if (!OPENAI_API_KEY) return null; // Skip if API key not set.
    
    try {
        const prompt = `Reply in a friendly and personal tone to a WhatsApp message from ${senderName}. The message is: "${incomingMessage}". Your reply should sound natural, as if I wrote it.`;
        const response = await axios.post('https://api.openai.com/v1/engines/text-davinci-003/completions', {
            prompt: prompt,
            max_tokens: 50,
            temperature: 0.7,
            n: 1,
            stop: null,
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            }
        });
        const aiReply = response.data.choices[0].text.trim();
        return aiReply;
    } catch (error) {
        console.error('Error generating AI reply:', error);
        return null;
    }
}

// Fallback reply generator in case AI is not used or fails, providing replies in Hinglish.
function generateDefaultReply(senderName) {
    return `Hi ${senderName}, i'm currently busy. I'll get back to you soon! `;
}

// --- Message Event Handler ---
client.on('message', async message => {
    console.log('Received message:', message.body);

    // Prevent replying to your own messages.
    if (message.fromMe) return;

    // Retrieve the sender's contact details.
    let contact = await message.getContact();
    let senderName = contact.pushname || contact.number;
    let senderNumber = contact.number.replace(/[^0-9]/g, ''); // Extract digits only.

    // Command handling for enabling/disabling auto-reply and checking status.
    const command = message.body.trim().toLowerCase();

    if (command === '!enable' && authorizedNumbers.includes(senderNumber)) {
        autoReplyEnabled = true;
        await message.reply('Auto-reply has been enabled. ✅');
        console.log("Auto-reply enabled via command. ✅");
        return;
    }

    if (command === '!disable' && authorizedNumbers.includes(senderNumber)) {
        autoReplyEnabled = false;
        await message.reply('Auto-reply has been disabled. ❌');
        console.log("Auto-reply disabled via command. ❌");
        return;
    }

    if (command === '!status' && authorizedNumbers.includes(senderNumber)) {
        const status = autoReplyEnabled ? 'enabled ✅' : 'disabled ❌';
        await message.reply(`Auto-reply is currently ${status}.`);
        console.log(`Auto-reply status queried: currently ${status}.`);
        return;
    }

    if (command === 'help') {
        const helpMessage = `
_Admin commands:_
!enable - *Enable* the auto-reply feature
!disable - *Disable* the auto-reply feature
!status - Check.
help - ~Display this help message~.
⚠ *This commands only for Admin*
        `;
        await message.reply(helpMessage);
        return;
    }

    // Do not auto-reply if auto-reply is not enabled.
    if (!autoReplyEnabled) {
        console.log("Auto-reply is disabled at this time.");
        return;
    }

    // Bypass auto-reply if message contains an "urgent" keyword.
    if (message.body.toLowerCase().includes('urgent')) {
        console.log("Urgent message detected; skipping auto-reply.");
        return;
    }

    // Generate a reply either via AI or use the default message.
    let replyText = await generateAIReply(senderName, message.body);
    if (!replyText) {
        replyText = generateDefaultReply(senderName);
    }

    // Send the reply.
    await message.reply(replyText);
    console.log(`Auto-reply sent to ${senderName}: ${replyText}`);
});

// Initialize the WhatsApp client.
client.initialize();
