    const { Client, LocalAuth } = require('whatsapp-web.js');
    const axios = require('axios');
    const qrcode = require('qrcode-terminal');
    require('dotenv').config();

    // WhatsApp Client Initialization
    // Prefer remote WA Web cache over stale pinned versions
    // Default to headless "new" so no Chrome window opens; can override via env
    const PUPPETEER_HEADLESS = (process.env.PUPPETEER_HEADLESS || 'new').toLowerCase();
    const PUPPETEER_EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
    const PERFORMANCE_MODE = String(process.env.PERFORMANCE_MODE || '').toLowerCase() === 'true';
    const PERF_LOG_INTERVAL_MS = parseInt(process.env.PERF_LOG_INTERVAL_MS || (PERFORMANCE_MODE ? '60000' : '0'), 10);

    const client = new Client({
        authStrategy: new LocalAuth(),
        // Always use a maintained remote cache for WA Web versions
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/wa-versions.json'
        },
        puppeteer: {
            // Respect env: "true" => true, "false" => false, anything else => 'new' (recommended)
            headless: PERFORMANCE_MODE
                ? true
                : (PUPPETEER_HEADLESS === 'true' ? true : (PUPPETEER_HEADLESS === 'false' ? false : 'new')),
            // Do not force system Chrome; use env to specify if desired
            executablePath: PUPPETEER_EXECUTABLE_PATH,
            defaultViewport: PERFORMANCE_MODE ? { width: 800, height: 600, deviceScaleFactor: 1 } : undefined,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--mute-audio',
                '--no-first-run',
                '--no-zygote',
                '--disable-background-networking',
                '--disable-background-timer-throttling',
                '--disable-renderer-backgrounding',
                '--disable-accelerated-2d-canvas',
                '--disable-features=site-per-process',
                PERFORMANCE_MODE ? '--window-size=800,600' : '--window-size=1280,800',
                '--lang=en-US'
            ],
            protocolTimeout: 120000,
            bypassCSP: true
        },
        takeoverOnConflict: true,
        takeoverTimeoutMs: 60000,
        qrMaxRetries: 5,
        // Correct option name per whatsapp-web.js
        restartOnAuthFail: true
    });

    // Admin numbers
    const authorizedNumbers = (process.env.AUTHORIZED_NUMBERS || '911234567890,911234567890')
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
    const MODEL = process.env.CHAT_MODEL || 'gpt-5-mini';

    // Utility logging
    function logWithTime(text) {
        console.log(`[${new Date().toLocaleTimeString()}] ${text}`);
    }

    if (!CHAT_API_KEY) {
        autoReplyEnabled = false;
        logWithTime('⚠ CHAT_API_KEY missing. Auto-reply disabled until key is provided in .env');
    }

    // Log selected WhatsApp Web version source and Puppeteer options
    logWithTime(`WA Web version: Remote cache`);
    logWithTime(`Puppeteer headless: ${PERFORMANCE_MODE ? 'true (perf mode)' : PUPPETEER_HEADLESS}`);
    if (PUPPETEER_EXECUTABLE_PATH) {
        logWithTime(`Puppeteer executable: ${PUPPETEER_EXECUTABLE_PATH}`);
    }
    if (PERFORMANCE_MODE) {
        logWithTime('Performance mode enabled: smaller viewport, extra Chrome flags, optional network blocking.');
    }

    // Import reply helper utilities
    const {
        safeJSONParse,
        buildSettingsPrompt,
        buildReplyPrompt,
        sanitizeReply,
        getTypingDelay,
        enforceSize,
    } = require('./lib/replyUtils');



    // First call: ask LLM for role, size, tone, language
    async function determineReplySettings(senderName, senderNumber, incomingMessage) {
        const history = chatHistory.get(senderNumber) || [];
        const prompt = buildSettingsPrompt(senderName, incomingMessage, history);
        try {
            const response = await axios.post(`${BASE_URL}/chat/completions`, {
                model: MODEL,
                messages: [
                    { role: 'system', content: 'You select messaging style settings. Return ONLY valid JSON with exactly the required keys/values. No markdown fences.' },
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
                    { role: 'system', content: 'You are a helpful WhatsApp assistant for short, safe, respectful replies. Follow instructions strictly; avoid harmful or sensitive content.' },
                    { role: 'user', content: prompt }
                ]
            }, {
                headers: {
                    'Authorization': `Bearer ${CHAT_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            const text = response?.data?.choices?.[0]?.message?.content?.trim() || null;
            return { text, settings };
        } catch (error) {
            console.error('[API Error: reply]', error.message);
            return { text: null, settings: { role: 'casual_friend', size: 'short', tone: 'friendly', language: 'hinglish' } };
        }
    }

    // Fallback reply if API fails
    function generateDefaultReply(senderName) {
        return `Hi ${senderName}, I'm a bit busy right now. Will ping you soon! 😊`;
    }

    // ...reply utils imported above...

    // Process queue sequentially
    const MAX_QUEUE = parseInt(process.env.MAX_QUEUE || '100', 10);

    async function processQueue() {
        if (isProcessing || messageQueue.length === 0) return;

        isProcessing = true;
        const { message, contact } = messageQueue.shift();
    const senderName = (contact && contact.pushname) || (contact && contact.number) || message.from || 'Unknown';
    const senderNumber = ((contact && contact.number) ? contact.number : (message.from || '')).replace(/\D/g, '');

        const seenDelay = Math.floor(Math.random() * 40000) + 2000; // 2-40 seconds

        setTimeout(async () => {
            try {
                // Sending 'seen' is optional and can break on WA web changes; wrap safely
                try {
                    const chatSeen = await message.getChat();
                    if (chatSeen && typeof chatSeen.sendSeen === 'function') {
                        await chatSeen.sendSeen();
                        logWithTime(`👀 Seen: ${message.body}`);
                    }
                } catch (err) {
                    logWithTime(`⚠️ sendSeen failed, continuing: ${err?.message || err}`);
                }

                const ai = await generateAIReply(senderName, senderNumber, message.body);
                let replyText = sanitizeReply(ai.text || generateDefaultReply(senderName));
                replyText = enforceSize(replyText, ai.settings?.size);

                const chat = await message.getChat();
                await chat.sendStateTyping();
                const typingDelay = getTypingDelay(replyText);

                logWithTime(`⌨️ Typing for ${typingDelay / 1000}s`);

                setTimeout(async () => {
                    try {
                        await chat.clearState();
                        // Try replying; if WA internal sendSeen throws, fall back to direct send
                        try {
                            await message.reply(replyText);
                        } catch (err) {
                            logWithTime(`⚠️ reply failed, falling back: ${err?.message || err}`);
                            await client.sendMessage(message.from, replyText);
                        }
                        logWithTime(`📤 to ${senderName}: ${replyText}`);

                        // Save message to history
                        if (!chatHistory.has(senderNumber)) {
                            chatHistory.set(senderNumber, []);
                        }
                        chatHistory.get(senderNumber).push(message.body);
                    } catch (err3) {
                        logWithTime(`❌ send pipeline error: ${err3?.message || err3}`);
                    } finally {
                        isProcessing = false;
                        processQueue();
                    }
                }, typingDelay);
            } catch (outerErr) {
                logWithTime(`❌ queue processor error: ${outerErr?.message || outerErr}`);
                isProcessing = false;
                processQueue();
            }
        }, seenDelay);
    }

    // Handle incoming messages
    client.on('message', async message => {
        // Strictly wait for 'ready' event; do not bypass on CONNECTED state
        if (!isBotReady) {
            logWithTime('⏸️ Message received but bot not ready yet. Ignored.');
            return;
        }
        if (message.fromMe || message.isStatus || message.from.includes('@g.us')) {
            logWithTime('📵 Ignored message.');
            return;
        }

        logWithTime(`📨 Received: ${message.body}`);

    const contact = await message.getContact();
    const senderNumber = ((contact && contact.number) ? contact.number : (message.from || '')).replace(/\D/g, '');
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

        // Prevent unbounded memory growth
        if (messageQueue.length >= MAX_QUEUE) {
            // drop oldest to prioritize recent messages
            messageQueue.shift();
            logWithTime(`⚠️ Queue at capacity (${MAX_QUEUE}). Dropping oldest.`);
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
        // Patch WA page: suppress errors from WWebJS.sendSeen due to upstream changes
        if (client.pupPage) {
            client.pupPage.evaluate(() => {
                try {
                    if (window.WWebJS && typeof window.WWebJS.sendSeen === 'function') {
                        const orig = window.WWebJS.sendSeen;
                        window.WWebJS.sendSeen = async function (...args) {
                            try {
                                return await orig.apply(this, args);
                            } catch (e) {
                                console.error('WWebJS.sendSeen suppressed error:', e?.message || e);
                                return false;
                            }
                        };
                    }
                } catch (e) {
                    console.error('Failed to patch sendSeen:', e?.message || e);
                }
            }).catch(err => {
                logWithTime(`⚠️ sendSeen patch failed: ${err?.message || err}`);
            });

            // Performance mode: block non-essential resources and disable animations
            if (PERFORMANCE_MODE) {
                client.pupPage.setRequestInterception(true).then(() => {
                    client.pupPage.on('request', req => {
                        const type = req.resourceType();
                        if (type === 'image' || type === 'media' || type === 'font') {
                            return req.abort();
                        }
                        return req.continue();
                    });
                }).catch(err => {
                    logWithTime(`⚠️ request interception failed: ${err?.message || err}`);
                });

                client.pupPage.addStyleTag({ content: '* { animation: none !important; transition: none !important; }' })
                    .catch(err => logWithTime(`⚠️ disable animations failed: ${err?.message || err}`));
            }
        }

        // Start perf logger if enabled
        if (PERF_LOG_INTERVAL_MS && PERF_LOG_INTERVAL_MS > 0) {
            startPerfLogger(PERF_LOG_INTERVAL_MS);
        }
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

    // --- Perf logger ---
    function startPerfLogger(intervalMs) {
        let lastCpu = process.cpuUsage();
        setInterval(() => {
            const mu = process.memoryUsage();
            const cpu = process.cpuUsage();
            const userMicros = cpu.user - lastCpu.user;
            const systemMicros = cpu.system - lastCpu.system;
            lastCpu = cpu;

            const rssMB = (mu.rss / (1024 * 1024)).toFixed(1);
            const heapUsedMB = (mu.heapUsed / (1024 * 1024)).toFixed(1);
            const externalMB = (mu.external / (1024 * 1024)).toFixed(1);

            // Report CPU time consumed in the interval (microseconds)
            logWithTime(`Perf: RSS=${rssMB}MB, Heap=${heapUsedMB}MB, Ext=${externalMB}MB, CPU(user+sys)=${userMicros + systemMicros}µs/${intervalMs}ms`);
        }, intervalMs).unref();
    }
