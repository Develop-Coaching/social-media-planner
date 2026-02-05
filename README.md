# Post Creator — Social content from your memory

A small web app that uses **Claude** for themes and copy (posts, reels, LinkedIn articles, carousels, quotes, YouTube scripts) and **Gemini** for images. Your context is stored in “memory” so theme ideas and tone stay on-brand.

## What it does

1. **Memory** — You add text (brand voice, topics, past content). It’s saved and used for everything below.
2. **Weekly themes** — One click: Claude suggests 5 weekly theme ideas based on that memory.
3. **Pick a theme** — You choose a theme, then set how many of each you want:
   - Posts (feed posts with caption + image prompt)
   - Reels (short video scripts)
   - LinkedIn articles (title + full article + hero image prompt)
   - Carousels (slide titles/bodies + style prompt)
   - Quotes for X (quote + card image prompt)
   - YouTube (title + script + optional thumbnail prompt)
4. **Generate content** — Claude generates all scripts, captions, and articles.
5. **Generate images** — For each item that has an image prompt, you can click “Generate image” and Gemini creates the image (posts, carousels, articles, quote cards, thumbnails).

## Setup

1. **Clone and install**
   ```bash
   cd "Post Creator Software"
   npm install
   ```

2. **Environment**
   - Copy `.env.example` to `.env.local`
   - Add your API keys:
     - **Claude:** [Anthropic Console](https://console.anthropic.com/) → `ANTHROPIC_API_KEY`
     - **Gemini:** [Google AI Studio](https://aistudio.google.com/apikey) → `GOOGLE_GENERATIVE_AI_API_KEY`

3. **Run**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

## Tech

- **Next.js 14** (App Router), TypeScript, Tailwind
- **Claude** (Anthropic) — themes + all text (captions, scripts, articles)
- **Gemini** (Google) — image generation for posts, carousels, articles, quotes, thumbnails
- **Memory** — Stored in `data/memory.json` (create `data/` if needed; it’s gitignored)

## Notes

- Add at least one “memory” (name + text) before clicking “Get theme ideas.”
- Image generation uses Gemini’s image model; if your key doesn’t have image access, use a key that does or disable image buttons in the UI.
