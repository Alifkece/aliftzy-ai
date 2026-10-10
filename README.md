# Aliftzy Codes AI

## Overview

Aliftzy Codes AI is a premium, dark-first AI chat app built with Next.js and powered by the Gemini API. The browser never talks to Google: every request goes through a server route that holds the API key.

```
Browser → Aliftzy Codes AI UI → /api/chat (server) → Gemini Interactions API → streamed response → Browser
```

## Features

- Real streaming responses (Gemini Interactions API with `stream: true`, newline-delimited JSON to the browser)
- Stop generation (keeps the partial response), regenerate / retry, copy
- Safe Markdown (tables, lists, blockquotes, inline code) and syntax-highlighted code blocks with copy
- Conversation history in `localStorage`: new chat, search, rename, delete, Today / Yesterday / Previous 7 Days groups
- Image, PDF, text/code and short video attachments with preview, validation, drag & drop and paste
- Smart auto-scroll with a floating “New response” button when you are reading older messages
- Animated AI Core orb (idle breathing, active pulse while generating), original SVG logo
- Dark (default) / Light / System theme, responsive layout with a mobile drawer, keyboard and screen-reader support

## Tech Stack

Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, `@google/genai`, `react-markdown` + `remark-gfm` + `rehype-highlight`. No animation library: everything is CSS (`transform` / `opacity`). Node.js 22 or later (required by `@google/genai` 3.x).

## Gemini API Integration

The reference code

```ts
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({});

const interaction = await ai.interactions.create({
  model: "gemini-3.8-flash",
  input: "Explain how AI works in a few words",
});
```

maps onto the server code like this:

| Reference | This project |
| --- | --- |
| `new GoogleGenAI({})` | `lib/gemini/client.ts` (the SDK reads `GEMINI_API_KEY` from the server environment) |
| `model: "gemini-3.8-flash"` | `GEMINI_MODEL`, default `gemini-3.8-flash`, defined only in `lib/gemini/config.ts` |
| `input: "..."` | `lib/gemini/build-input.ts` converts validated frontend messages into `user_input` / `model_output` steps with text, image, document and video parts |
| `interactions.create(...)` | `app/api/chat/route.ts`, with `stream: true`; text is read from `step.delta` events whose `delta.type` is `text` |

Conversations are **stateless**: the full history is sent on every request and `store: false` is set, so Google does not keep your chats and nothing depends on a stored interaction id. The model id is never swapped silently. If it is unavailable, the user sees “The configured Gemini model is unavailable…”, and you change `GEMINI_MODEL`.

## Environment Variables

```
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
# optional
GEMINI_MODEL_LABEL=Gemini Flash
GEMINI_MAX_OUTPUT_TOKENS=32768
# low (default, fastest) | medium | high
GEMINI_THINKING_LEVEL=low
```

All are server-side. Never prefix them with `NEXT_PUBLIC_`. Create a key in Google AI Studio (https://aistudio.google.com/apikey).

## Local Development

1. `git clone <your-repo-url> && cd aliftzy-claude`
2. `npm install`
3. `cp .env.example .env.local`
4. Put your key in `.env.local`: `GEMINI_API_KEY=...`
5. `npm run dev` and open http://localhost:3000

## GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<you>/aliftzy-claude.git
git push -u origin main
```

`.env`, `.env.local` and `.env.production.local` are ignored by `.gitignore`.

## Vercel Deployment

1. Push the repository to GitHub.
2. In Vercel choose **Add New → Project** and import the repository (framework: Next.js, auto-detected).
3. Open **Settings → Environment Variables** and add `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`). Use the same names as above.
4. Click **Deploy**. After changing a variable later, redeploy.

`/api/chat` runs on the Node.js runtime in Singapore (`preferredRegion = "sin1"`, change it in `app/api/chat/route.ts`) with `maxDuration = 300`. Lower the value in `app/api/chat/route.ts` if your Vercel plan caps it.

## Security

- The API key exists only in the server environment. It is not in client bundles, `public/`, `localStorage` or the repository.
- `server-only` guards the Gemini modules so importing them from a client component fails the build.
- The server validates every request: roles, message count and length, attachment count, size, base64, and file signatures (image, PDF and video magic bytes). The declared MIME type is not trusted.
- Gemini errors are mapped to safe messages; no keys, stack traces or raw upstream bodies reach the browser. Key-like strings are redacted.
- Markdown never renders raw HTML. Links are limited to `http(s)` and `mailto`, open with `noopener noreferrer`, and remote images are not loaded.
- Security headers are set in `next.config.mjs`.
- There is no rate limiting or authentication: anyone who can open your deployment can spend your Gemini quota. Add auth or rate limiting (for example Vercel Firewall or a middleware) before sharing the URL publicly.

## File Upload

Flow: `Attachment` (UI state) → `lib/files/process.ts` (client validation and reading) → `/api/chat` (server validation) → `lib/gemini/build-input.ts` (Gemini content parts).

- PDF: sent as a `document` part with `application/pdf`.
- Text, code, CSV, JSON, Markdown and similar: inlined as text.
- Other formats (Word, Excel, …) are rejected with “Unsupported file type.”
- Binary data is held in memory only and never written to `localStorage`. After a page reload, earlier attachments are referenced by file name only.

Limits live in `lib/files/rules.ts`: 3 MB per image, PDF or video, 1 MB per text file, 5 attachments per message. They are conservative because Vercel serverless functions reject request bodies above roughly 4.5 MB, and base64 adds about 33%. Gemini itself accepts much larger inline requests (about 20 MB) and bigger files through its Files API; using it would need a direct-upload design (see Future Improvements).

## Image Support

JPEG, PNG and WebP are sent as `image` parts, placed before the text prompt. GIF is not accepted because the Gemini image documentation lists no GIF support. Images are decoded in the browser to check they are valid, and the server checks the file signature again.

## Video Support

Short videos (MP4, WebM, MOV, up to 3 MB) are sent inline as `video` parts, and Gemini can analyze them. The limit is set by Vercel's request size, not by Gemini. Longer videos need the Gemini Files API with a direct-upload flow, which is not built yet. Video analysis depends on the current Gemini API/model capabilities.

## Known Limitations

- Conversations live in one browser's `localStorage` (about 5 MB quota); they do not sync across devices.
- Request bodies are limited by Vercel (see File Upload), so media files must be small.
- Regenerate is available for the last response only.
- Switching conversations while a response is generating stops it and keeps the partial text.
- Stopping generation stops reading the stream immediately; whether Google also cancels the upstream request depends on the SDK.
- No authentication or rate limiting.

## Future Improvements

- Database persistence (replace `lib/chat/storage.ts`) and user accounts
- Gemini Files API with direct upload for large images, PDFs and videos
- Google Search grounding, code execution and function calling (only when they have a working UI)
- AI-generated conversation titles
