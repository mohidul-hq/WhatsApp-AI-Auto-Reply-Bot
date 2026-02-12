# WhatsApp AI Auto‑Reply Bot

An automated WhatsApp responder that reads incoming messages and crafts short, human‑like replies using an LLM. It runs on top of `whatsapp-web.js` with Puppeteer and supports a lightweight performance mode for lower CPU and memory usage.

## Features

- Auto‑reply using a two‑step LLM flow:
  - Step 1: Pick reply style (role, size, tone, language)
  - Step 2: Generate a concise reply following those settings
- Human‑like behavior: “seen”, typing indicator, short delays
- Queue + backpressure: processes messages sequentially with a max queue length
- Admin controls (from authorized numbers): `!enable`, `!disable`, `!status`, `help`
- Safe, compact replies: sanitization and post‑generation size enforcement
- Performance mode: blocks heavy resources and disables animations to reduce CPU/RAM
- Resilient to WhatsApp Web changes (remote web version cache, guarded `sendSeen`)

## How it works (reply system)

1. Message filter
   - Ignores groups, status updates, self messages
   - Skips very long messages, links, and non‑text types
2. Queueing
   - Incoming messages are pushed into a FIFO queue
   - A single worker processes one message at a time (prevents overlaps)
3. Two‑call LLM flow
   - Call A (settings): asks the model to return JSON with `role`, `size`, `tone`, `language`
   - Call B (reply): uses those settings and recent context to generate the reply text
4. Post‑processing
   - Sanitizes the output (removes code fences, newlines, extra spaces)
   - Enforces size (e.g., `veryVeryshort` = exactly one word)
5. Send sequence
   - Optionally marks chat as seen (guarded)
   - Shows typing state for a short, length‑based delay
   - Sends the reply; if `message.reply` fails, falls back to `client.sendMessage`
6. History
   - Stores a small slice of recent incoming messages per sender for better context

Key files:
- `MyBestWithAPI.js` — main bot
- `lib/replyUtils.js` — helper functions for prompts, sanitation, size enforcement, typing delays
- `Tests/unit-replyUtils.js` — minimal tests for helper functions (no external framework)

## Requirements

- Node.js 18+ (Puppeteer 24 requires modern Node)
- Git (for clone) or a ZIP extractor (for manual download)
- A WhatsApp account (you’ll scan a QR code)
- An API key for your chat completion provider (this project defaults to ChatAnywhere)

## Get the code from GitHub

Choose one of the two methods:

- Clone (recommended)
  ```bash
  git clone https://github.com/mohidul-hq/WhatsApp-AI-Auto-Reply-Bot.git
  cd WhatsApp-AI-Auto-Reply-Bot
  ```
- Download ZIP
  1) Go to your repository page on GitHub
  2) Click the green “Code” button → “Download ZIP”
  3) Extract the ZIP and open the folder in VS Code

If this folder is already your working copy, you can skip this section.

## Quick Start — step by step

1) Install Node dependencies
```bash
npm install
```

2) Create a `.env` file (start from the example)
```bash
cp .env.example .env
```
Edit `.env` with your values. Key variables:
- `CHAT_API_KEY` — your API key for the chat provider
- `CHAT_BASE_URL` — default: `https://api.chatanywhere.tech/v1`
- `CHAT_MODEL` — default: `gpt-5-mini`
- `AUTHORIZED_NUMBERS` — comma‑separated E.164 numbers without `+` (e.g., `911234567890,911234567891`)
- `PUPPETEER_HEADLESS` — `true`, `false`, or `new` (default: `new`)
- `PUPPETEER_EXECUTABLE_PATH` — optional path to Chrome/Chromium
- `PERFORMANCE_MODE` — `true` to reduce CPU/RAM (headless true, smaller viewport, block images/media/fonts)
- `PERF_LOG_INTERVAL_MS` — perf log interval in ms (default 60000 when perf mode is on; `0` to disable)
- `MAX_QUEUE` — maximum pending messages to keep (default 100)

Example `.env`:
```
CHAT_API_KEY=sk-…
CHAT_BASE_URL=https://api.chatanywhere.tech/v1
CHAT_MODEL=gpt-5-mini
AUTHORIZED_NUMBERS=911234567890,911234567891
PUPPETEER_HEADLESS=new
PERFORMANCE_MODE=true
PERF_LOG_INTERVAL_MS=60000
MAX_QUEUE=100
```

3) Run the bot

```bash
npm start
```
On first run, you’ll see a QR code in the terminal. Open WhatsApp on your phone → Linked devices → Link a device → scan the QR.

The bot will log events such as “Authenticated”, “ready”, and then it will start processing incoming messages.



5) (Optional) Update to the latest code later

```bash
git pull --rebase
npm install
```
6) Connect with your whatsapp 
```bash
 
```

### Windows notes
- This project uses Puppeteer. If Chrome/Chromium fails to launch, set `PUPPETEER_HEADLESS=true` in `.env` or specify `PUPPETEER_EXECUTABLE_PATH` to your Chrome path (e.g., `C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe`).
- If `cp` doesn’t work in your shell, you can copy the file manually in Explorer or use PowerShell: `Copy-Item .env.example .env`.

## Admin commands

From a number listed in `AUTHORIZED_NUMBERS`:
- `!enable` — enable auto‑reply
- `!disable` — disable auto‑reply
- `!status` — show whether auto‑reply is enabled
- `help` — show help text

## Performance mode

Set `PERFORMANCE_MODE=true` to:
- Force classic headless Chrome
- Shrink viewport and add conservative Chrome flags
- Block requests for images, media, and fonts
- Disable page animations
- Optional periodic perf logs (RSS/heap/external memory + CPU time)

This significantly reduces CPU and memory usage while keeping WhatsApp Web operational.

## Tests

Run minimal unit tests for the reply utilities:
```bash
npm test
```

## Troubleshooting

- QR doesn’t show or browser fails to start
  - Ensure Node 18+, reinstall `node_modules`, try `PUPPETEER_HEADLESS=true`
- Stuck on “waiting for ready”
  - The bot includes watchdog logs and a page reload fallback; check logs; try restarting
- `sendSeen` errors in logs
  - They’re suppressed to avoid breaking; not critical
- High CPU or memory
  - Turn on `PERFORMANCE_MODE=true`, keep headless on, and avoid keeping the bot in the foreground
- Messages not replying
  - Confirm `AUTHORIZED_NUMBERS` and that auto‑reply is enabled (`!status`)
  - Check that messages aren’t filtered (links, >1000 chars, non‑text types are skipped)

## Notes on stability

- WhatsApp Web changes frequently. This project uses a remote WA Web version cache via `whatsapp-web.js` to improve compatibility.
- The send pipeline has a guarded fallback and won’t stall the queue on errors.

## License

ISC (see `package.json`).
