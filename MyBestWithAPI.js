    const { Client, LocalAuth } = require('whatsapp-web.js');
    const axios = require('axios');
    const qrcode = require('qrcode-terminal');
    require('dotenv').config();

    // WhatsApp Client Initialization
    const PINNED_WEB_VERSION = process.env.WPP_WEB_VERSION; // e.g., "2.2345.4"
    const PUPPETEER_HEADLESS = (process.env.PUPPETEER_HEADLESS || 'new').toLowerCase();
    const PUPPETEER_EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

    const client = new Client({
        authStrategy: new LocalAuth(),
        webVersion: PINNED_WEB_VERSION || undefined,
        webVersionCache: PINNED_WEB_VERSION ? { type: 'none' } : {
            // Use a remote WA Web version list to avoid stale versions
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/wa-versions.json'
        },
        puppeteer: {
            headless: PUPPETEER_HEADLESS === 'true' ? true : (PUPPETEER_HEADLESS === 'false' ? false : 'new'),
            executablePath: PUPPETEER_EXECUTABLE_PATH,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-features=site-per-process',
                '--window-size=1280,800',
                '--lang=en-US'
            ],
            bypassCSP: true
        },
        takeoverOnConflict: true,
        takeoverTimeoutMs: 60000,
        qrMaxRetries: 5,
        restartOnAuthFailure: true
    });

    // Admin numbers
    const authorizedNumbers = (process.env.AUTHORIZED_NUMBERS || '917864987971,919531976493')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    let autoReplyEnabled = true;
    let isBotReady = false;

    // Message queue & state
    const messageQueue = [];
    let isProcessing = false;

    // Chat history for context
    const chatHistory = new Map(); // key: number, value: array of messages

    // API config
    const CHAT_API_KEY = process.env.CHAT_API_KEY;
    const BASE_URL = process.env.CHAT_BASE_URL || 'https://api.chatanywhere.tech/v1';
    const MODEL = process.env.CHAT_MODEL || 'gpt-4.1-mini';

    // Utility logging
    function logWithTime(text) {
        console.log(`[${new Date().toLocaleTimeString()}] ${text}`);
    }

    if (!CHAT_API_KEY) {
        autoReplyEnabled = false;
        logWithTime('⚠ CHAT_API_KEY missing. Auto-reply disabled until key is provided in .env');
    }

    // Log selected WhatsApp Web version source and Puppeteer options
    logWithTime(`WA Web version: ${PINNED_WEB_VERSION ? 'Pinned ' + PINNED_WEB_VERSION : 'Remote cache'}`);
    logWithTime(`Puppeteer headless: ${PUPPETEER_HEADLESS}`);
    if (PUPPETEER_EXECUTABLE_PATH) {
        logWithTime(`Puppeteer executable: ${PUPPETEER_EXECUTABLE_PATH}`);
    }

    // Build prompt to determine reply settings (role, size, tone, language)
    function buildSettingsPrompt(senderName, incomingMessage, history = []) {
        const contextMessages = history.slice(-3).map((msg, i) => `Prev msg ${i + 1}: ${msg}`).join('\n');
        return `You are selecting messaging style settings for a WhatsApp reply.\n\n` +
            `Input:\n` +
            `- Sender: ${senderName}\n` +
            `- Message: "${incomingMessage}"\n` +
            `${contextMessages ? `- Context:\n${contextMessages}\n` : ''}` +
            `\nDecide the following fields as a single JSON object with ONLY these keys and allowed values. Do not add explanations or extra text.\n` +
            `- role: one of ["casual_friend", "romantic_flirt", "helpful_support"]\n` +
            `- size: one of ["short", "medium", "long"]\n` +
            `- tone: one of ["friendly", "funny", "romantic", "serious", "formal"]\n` +
            `- language: one of ["hinglish", "banglish", "english"]\n` +
            `\nGuidelines:\n` +
            `- Prefer "hinglish" or "banglish" in roman script for casual chat.\n` +
            `- If message is sensitive or formal, choose "english" and "serious" or "formal" tone.\n` +
            `- If flirting/romance is implied and appropriate, choose "romantic_flirt" with "romantic" tone.\n` +
            `- Choose size based on how much detail is likely needed.\n` +
            `\nReturn JSON only, e.g.: {"role":"casual_friend","size":"short","tone":"friendly","language":"hinglish"}`;
    }

    // Build prompt for the assistant using chosen settings
    function buildReplyPrompt(senderName, incomingMessage, settings, history = []) {
        const contextMessages = history.slice(-3).map((msg, i) => `Prev msg ${i + 1}: ${msg}`).join('\n');

        const sizeLimits = {
            short: 20,
            medium: 50,
            long: 100
        };

        const wordLimit = sizeLimits[settings.size] || sizeLimits.short;

        const languageGuide = settings.language === 'banglish'
            ? 'Use Bangla + English (Banglish) in roman script.'
            : settings.language === 'hinglish'
                ? 'Use Hindi + English (Hinglish) in roman script.'
                : 'Use natural English.';

        const roleGuide = settings.role === 'helpful_support'
            ? 'Be helpful and clear like friendly support.'
            : settings.role === 'romantic_flirt'
                ? 'Be playful and romantic only if context is appropriate.'
                : 'Sound like a chill close friend.';

        const toneGuide = `Tone: ${settings.tone}.`;

        return `You are Mohidul, a chill teenage Indian boy acting as a friendly WhatsApp assistant.\n` +
            `${roleGuide}\n${toneGuide}\n${languageGuide}\n` +
            `Keep replies WhatsApp-style: human, casual, emoji-friendly, NO long paragraphs, no mention of AI/bots/religion/politics/personal details.\n` +
            `If sender seems male, "bhai/bhiya" is okay. If female, "didi/yaar" is okay. If uncertain/foreign, keep neutral.\n` +
            `Respect note: If name is "abdul hanif" respond respectfully; he is my bhiya.\n\n` +
            `Word limit: ${wordLimit} words (single line unless truly needed).\n` +
            `Incoming from ${senderName}: "${incomingMessage}"\n` +
            `${contextMessages ? contextMessages + '\n' : ''}` +
            `\nNow write the reply.`;
    }

    function safeJSONParse(text) {
        if (!text) return null;
        try {
            const cleaned = text
                .replace(/^```json[\r\n]*/i, '')
                .replace(/^```[\r\n]*/i, '')
                .replace(/```$/i, '')
                .trim();
            return JSON.parse(cleaned);
        } catch {
            return null;
        }
    }



    // First call: ask LLM for role, size, tone, language
    async function determineReplySettings(senderName, senderNumber, incomingMessage) {
        const history = chatHistory.get(senderNumber) || [];
        const prompt = buildSettingsPrompt(senderName, incomingMessage, history);
        try {
            const response = await axios.post(`${BASE_URL}/chat/completions`, {
                model: MODEL,
                messages: [
                    { role: 'system', content: 'You select messaging style settings. Return ONLY valid JSON.' },
                    { role: 'user', content: prompt }
                ]
            }, {
                headers: {
                    'Authorization': `Bearer ${CHAT_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });
            const raw = response?.data?.choices?.[0]?.message?.content?.trim();
            const parsed = safeJSONParse(raw);
            if (parsed && parsed.role && parsed.size && parsed.tone && parsed.language) {
                logWithTime(`🧪 Settings: role=${parsed.role}, size=${parsed.size}, tone=${parsed.tone}, lang=${parsed.language}`);
                return parsed;
            }
            return { role: 'casual_friend', size: 'short', tone: 'friendly', language: 'hinglish' };
        } catch (error) {
            console.error('[API Error: settings]', error.message);
            return { role: 'casual_friend', size: 'short', tone: 'friendly', language: 'hinglish' };
        }
    }

    // Second call: generate reply using settings
    async function generateAIReply(senderName, senderNumber, incomingMessage) {
        try {
            const history = chatHistory.get(senderNumber) || [];
            const settings = await determineReplySettings(senderName, senderNumber, incomingMessage);
            const prompt = buildReplyPrompt(senderName, incomingMessage, settings, history);

            const response = await axios.post(`${BASE_URL}/chat/completions`, {
                model: MODEL,
                messages: [
                    { role: 'system', content: 'You are a helpful WhatsApp assistant. Follow instructions strictly.' },
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
            console.error('[API Error: reply]', error.message);
            return null;
        }
    }

    // Fallback reply if API fails
    function generateDefaultReply(senderName) {
        return `Hi ${senderName}, I'm a bit busy right now. Will ping you soon! 😊`;
    }

    // Simulate human-like delay based on reply length
    function getTypingDelay(replyText) {
        const words = replyText.split(/\s+/).length;
        return Math.min(8000 + words * 300, 30000); // Typing delay 8s to 30s based on word count
    }

    // Process queue sequentially
    async function processQueue() {
        if (isProcessing || messageQueue.length === 0) return;

        isProcessing = true;
        const { message, contact } = messageQueue.shift();
        const senderName = contact.pushname || contact.number;
        const senderNumber = contact.number.replace(/\D/g, '');

        const seenDelay = Math.floor(Math.random() * 40000) + 2000; // 2-40 seconds

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

                // Save message to history
                if (!chatHistory.has(senderNumber)) {
                    chatHistory.set(senderNumber, []);
                }
                chatHistory.get(senderNumber).push(message.body);

                isProcessing = false;
                processQueue();
            }, typingDelay);
        }, seenDelay);
    }

    // Handle incoming messages
    client.on('message', async message => {
        // Allow processing if CONNECTED even if 'ready' not fired
        if (!isBotReady) {
            try {
                const state = await client.getState();
                if (state !== 'CONNECTED') {
                    logWithTime('⏸️ Message received but bot not ready yet. Ignored.');
                    return;
                }
                // Mark operational based on CONNECTED state
                isBotReady = true;
                logWithTime('🟢 Marked ready on first message (CONNECTED state).');
            } catch {
                logWithTime('⏸️ Message received but state unknown. Ignored.');
                return;
            }
        }
        if (message.fromMe || message.isStatus || message.from.includes('@g.us')) {
            logWithTime('📵 Ignored message.');
            return;
        }

        logWithTime(`📨 Received: ${message.body}`);

        const contact = await message.getContact();
        const senderNumber = contact.number.replace(/\D/g, '');
        const command = message.body.trim().toLowerCase();
        const isAuthorized = authorizedNumbers.includes(senderNumber);

        // Admin command handler
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

    // Show QR code on start + extra diagnostics
    client.on('qr', qr => {
        console.log('📲 Scan this QR code to log in:');
        qrcode.generate(qr, { small: true });
    });

    client.on('loading_screen', (percent, message) => {
        logWithTime(`⏳ Loading: ${percent}% - ${message}`);
    });

    client.on('authenticated', () => {
        logWithTime('✅ Authenticated');
    });

    client.on('auth_failure', msg => {
        logWithTime(`❌ Auth failure: ${msg}`);
    });

    client.on('change_state', state => {
        logWithTime(`🔁 State changed: ${state}`);
    });

    client.on('disconnected', reason => {
        logWithTime(`🔌 Disconnected: ${reason}`);
    });

    // Simplified readiness fallback: proceed when CONNECTED

    // Watchdog: if authenticated but not ready soon, report state
    let readyWatchdog = null;
    client.on('authenticated', () => {
        if (readyWatchdog) clearTimeout(readyWatchdog);
        readyWatchdog = setTimeout(async () => {
            try {
                const state = await client.getState();
                logWithTime(`⏱ Still waiting for ready. Current state: ${state}`);
                // Fallback: if connected but ready not fired, mark bot operational
                if (state === 'CONNECTED' && !isBotReady) {
                    isBotReady = true;
                    logWithTime('🟢 Proceeding without ready event (CONNECTED state). Bot operational.');
                }
            } catch (e) {
                logWithTime('⏱ Still waiting for ready. State unavailable.');
            }
        }, 30000);

        // Secondary fallback: reload page if still not ready after 60s
        setTimeout(async () => {
            try {
                if (!isBotReady) {
                    logWithTime('🔄 Reloading WhatsApp Web page to recover readiness...');
                    if (client.pupPage && typeof client.pupPage.reload === 'function') {
                        await client.pupPage.reload({ waitUntil: 'networkidle2' });
                        // Brief wait then re-check state
                        setTimeout(async () => {
                            try {
                                const state = await client.getState();
                                logWithTime(`🔄 Post-reload state: ${state}`);
                                if (state === 'CONNECTED' && !isBotReady) {
                                    isBotReady = true;
                                    logWithTime('🟢 Ready after reload (CONNECTED).');
                                }
                            } catch (err) {
                                logWithTime(`⚠ Post-reload state check failed: ${err?.message || err}`);
                            }
                        }, 5000);
                    } else {
                        logWithTime('⚠ Puppeteer page reload is not available.');
                    }
                }
            } catch (err) {
                logWithTime(`⚠ Reload attempt failed: ${err?.message || err}`);
            }
        }, 60000);
    });

    // Bot ready
    client.on('ready', () => {
        console.log(`🤖 is ready and running!`);
        if (readyWatchdog) clearTimeout(readyWatchdog);
        isBotReady = true;
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('👋 Gracefully shutting down...');
        client.destroy();
        process.exit();
    });

    // Error logging only (no restart)
    process.on('uncaughtException', (err) => {
        console.error('💥 Uncaught Exception:', err);
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('💥 Unhandled Rejection:', reason);
    });

    // Initialize WhatsApp bot
    client.initialize();
