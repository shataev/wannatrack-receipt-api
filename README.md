# Wannatrack Receipt API

Telegram bot and REST API for the [Wanna Track](https://github.com/shataev/wanna-track) expense tracking system. Receives receipt photos or text, analyzes them via AI, and saves expenses to the main app.

## How it works

1. User sends a receipt photo or text message to the Telegram bot
2. Bot downloads the photo from Telegram and forwards it to the AI analyzer
3. AI returns extracted data: merchant, amount, currency, date
4. Bot shows the result with inline keyboards for category and fund selection
5. User selects category → selects fund → expense is saved to the main app

## Part of the Wanna Track system

| Service | Stack | Description |
|---------|-------|-------------|
| [wanna-track](https://github.com/shataev/wanna-track) | Vue 3, Vite, Vuetify 3 | Web app for expense management |
| **wannatrack-receipt-api** | NestJS, TypeScript, Telegraf | This repo — Telegram bot + REST API |
| [wannatrack-ai-analyzer](https://github.com/shataev/wannatrack-ai-analyzer) | FastAPI, Python | OCR + LLM receipt parsing microservice |

## Tech stack

- **NestJS** + TypeScript
- **Telegraf** — Telegram bot framework
- **Axios** — HTTP client for AI service communication

## Setup

```bash
npm install
```

Create `.env`:

```env
TG_TOKEN=your_telegram_bot_token
API_BASE_URL=http://localhost:3000
AI_SERVICE_URL=http://localhost:8000
PORT=3000
```

```bash
# development
npm run start:dev

# production
npm run start:prod
```

## Project structure

```
src/
├── receipts/          # Receipt analysis — controller, service, DTOs
│   └── ai-client/     # AI service integration
├── telegram-bot/      # Telegram bot — update handler, service
└── core-api/          # Main app API integration
```

## Testing the bot

1. Send `/start` — bot responds with welcome message
2. Send a text: `Bought groceries at Tops for 350 THB` — bot extracts and confirms
3. Send a receipt photo — bot runs OCR + AI analysis and shows the result

## Run tests

```bash
npm run test
npm run test:e2e
```
