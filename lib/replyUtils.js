// Utility functions for reply generation and sanitation

function safeJSONParse(text) {
    if (!text) return null;
    try {
        const cleaned = String(text)
            .replace(/^```json[\r\n]*/i, '')
            .replace(/^```[\r\n]*/i, '')
            .replace(/```$/i, '')
            .trim();
        return JSON.parse(cleaned);
    } catch {
        return null;
    }
}

function buildSettingsPrompt(senderName, incomingMessage, history = []) {
    const contextMessages = history.slice(-3).map((msg, i) => `Prev msg ${i + 1}: ${msg}`).join('\n');
    return (
        `You choose messaging style settings for a WhatsApp reply. Output MUST be a single valid JSON object with EXACTLY these four keys and allowed values. NO extra text, NO markdown fences.\n\n` +
        `Input:\n` +
        `- Sender: ${senderName}\n` +
        `- Message: "${incomingMessage}"\n` +
        `${contextMessages ? `- Context:\n${contextMessages}\n` : ''}` +
        `\nSchema (use only these values):\n` +
        // Fixed: remove stray leading spaces from "veryVeryshort"
        `- role: ["casual_friend", "romantic_flirt", "helpful_support"]\n` +
        `- size: ["veryVeryshort", "veryshort", "short", "medium", "long"]\n` +
        `- tone: ["friendly", "funny", "romantic", "serious", "formal"]\n` +
        `- language: ["hinglish", "banglish", "english"]\n\n` +
        `Selection rules:\n` +
        `- Prefer "hinglish" or "banglish" (romanized) for casual chat.\n` +
        `- Use "english" with "serious"/"formal" when message is sensitive, formal, or unclear.\n` +
        `- Choose "helpful_support" for questions, links, or requests.\n` +
        `- Choose "romantic_flirt" ONLY when flirting is explicit/appropriate; avoid sexual content.\n` +
        `- size: veryVeryshort (exactly 1 word like "ok", "done", "yes", "no"), veryshort (2-4 words; greetings/ack), short (quick reply), medium (some detail), long (more guidance).\n\n` +
        `Return JSON ONLY, for example: {"role":"casual_friend","size":"short","tone":"friendly","language":"hinglish"}`
    );
}

function buildReplyPrompt(senderName, incomingMessage, settings, history = []) {
    const contextMessages = history.slice(-3).map((msg, i) => `Prev msg ${i + 1}: ${msg}`).join('\n');

    const sizeLimits = {
        veryVeryshort: 1,
        veryshort: 4,
        short: 18,
        medium: 35,
        long: 70
    };

    const wordLimit = sizeLimits[settings.size] || sizeLimits.short;

    const lengthRule = settings.size === 'veryVeryshort'
        ? 'Reply with EXACTLY 1 word. No punctuation or emojis.'
        : settings.size === 'veryshort'
            ? 'Reply in at most 4 words. Keep it crisp.'
            : `Hard limit: ${wordLimit} words.`;

    const languageGuide = settings.language === 'banglish'
        ? 'Write in Bangla+English (Banglish) using roman script.'
        : settings.language === 'hinglish'
            ? 'Write in Hindi+English (Hinglish) using roman script.'
            : 'Write in natural English.';

    const roleGuide = settings.role === 'helpful_support'
        ? 'Be helpful and clear like friendly support.'
        : settings.role === 'romantic_flirt'
            ? 'Be playful and romantic only when appropriate. Avoid NSFW.'
            : 'Sound like a chill close friend.';

    const toneGuide = `Tone: ${settings.tone}.`;

    return (
        `You are Mohidul, a friendly WhatsApp assistant.\n` +
        `${roleGuide}\n${toneGuide}\n${languageGuide}\n` +
        `Style rules:\n` +
        `- Keep it human, casual, concise.\n` +
        `- 0-2 emojis max; no long paragraphs.\n` +
        `- No talk about AI/bots, privacy, politics, religion, or personal details.\n` +
        `- Use respectful language.\n` +
        `- If sender seems male, "bhai/bhiya" is okay; if female, "didi/yaar" is okay; else neutral.\n` +
        `- If name is "abdul hanif", be extra respectful.\n` +
        `- Prefer a single line unless truly needed.\n\n` +
        `${lengthRule}\n` +
        `Incoming from ${senderName}: "${incomingMessage}"\n` +
        `${contextMessages ? contextMessages + '\n' : ''}` +
        `\nWrite the reply now.`
    );
}

function sanitizeReply(text) {
    if (!text) return '';
    let t = String(text)
        .replace(/^```+[a-z]*\n?/i, '')
        .replace(/```+$/i, '')
        .replace(/[\r\n]+/g, ' ')
        .trim();
    t = t.replace(/\s{2,}/g, ' ').trim();
    if (t.length > 600) t = t.slice(0, 600).trim();
    return t;
}

function getTypingDelay(replyText) {
    const words = replyText.trim().length ? replyText.trim().split(/\s+/).length : 0;
    if (words <= 1) return 1500;
    if (words <= 4) return 3000;
    return Math.min(6000 + words * 250, 25000);
}

function enforceSize(text, size) {
    if (!text) return text;
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (size === 'veryVeryshort') {
        const first = words[0] || '';
        return first.replace(/^[^\p{L}\p{N}@#]+|[^\p{L}\p{N}@#]+$/gu, '');
    }
    const limits = { veryshort: 4, short: 18, medium: 35, long: 70 };
    const maxw = limits[size] || null;
    if (!maxw) return text;
    return words.slice(0, maxw).join(' ');
}

module.exports = {
    safeJSONParse,
    buildSettingsPrompt,
    buildReplyPrompt,
    sanitizeReply,
    getTypingDelay,
    enforceSize,
};
