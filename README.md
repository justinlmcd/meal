# MEAL.

Log what you eat three ways: photograph the plate and let the AI name each food with calories and macros, scan a packaged food's barcode, or type it in. Daily calorie and macro goals, a calories-per-day line against your goal, a macro split, and a diary by meal. One page, your data in your own Supabase database.

## How the three ways work

- **Photo a meal.** The browser shrinks the picture and sends it to a small server function on Vercel. That function asks Claude (`claude-opus-5-5`) to identify each food, estimate the portion, and return calories, protein, carbs and fat as structured JSON. You see the list with a confidence label per item, untick anything wrong, and log the rest. The API key never reaches the browser, and the function only answers signed-in users. Treat the numbers as estimates: a photo can't weigh your food.
- **Scan a barcode.** The camera opens in the page. Chrome and Android use the built-in barcode detector; Safari loads a small scanning library instead. The number is looked up on [Open Food Facts](https://world.openfoodfacts.org), a free open database. Anything you scan is saved to your foods so the next scan is instant and works offline from the database. If a product is missing, type it in once and tick "save".
- **Type it in.** Search your saved foods or enter name, portion, calories and macros by hand.

## Set up (about 15 minutes)

1. **Supabase.** Create a project at supabase.com (or reuse one you already have). In **SQL Editor**, paste the contents of [setup.sql](setup.sql) and click **Run**. Do this once.
2. **A login.** In **Authentication → Users**, click **Add user**, enter your email and a password, and tick **Auto confirm**. Skip if you already have a user on this project.
3. **An Anthropic API key** for the photo feature. Create one at console.anthropic.com → API keys. Photo analysis costs a few cents per picture. Everything else works without it.
4. **Vercel.** Import this repository at vercel.com → Add New → Project. Framework preset **Other**, no build command, root directory blank.
5. **Three environment variables** on that Vercel screen:
   - `SUPABASE_URL` → your project URL (Supabase → Connect dialog)
   - `SUPABASE_PUBLISHABLE_KEY` → the key starting `sb_publishable_`
   - `ANTHROPIC_API_KEY` → the key from step 3
6. **Deploy.** Open the URL Vercel gives you, click **Sign in**, set your goals, and log your first meal.

Vercel redeploys on every push to `main`.

## Your coach

A card near the top reads your own recent data and tells you how you are doing: a score out of ten, what is going well, what to change, and one next step. Nothing is sent until you press **Ask the coach**, and the last answer is kept on your device. It runs on Claude through a small Vercel function, so you need one extra environment variable in Vercel: `ANTHROPIC_API_KEY`, created at console.anthropic.com under API keys. Each ask costs about a cent. Without the key, the card simply says the coach is off.

## Run locally

```
npm install
SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... node dev.js
```

Then open http://localhost:8800. Barcode scanning needs HTTPS or localhost for camera access, so it works locally and on Vercel. Photo analysis only runs on Vercel.

## What's in it

- `index.html` — the page and its styles
- `meal.js` — sign-in, loading, goals, charts, diary, the barcode scanner, and the photo flow
- `api/analyze.mjs` — the Vercel function that sends a photo to Claude and returns foods as JSON
- `api/config.js` — hands the two public Supabase settings to the page
- `quote-of-day.js` — a quote that changes at local midnight
- `setup.sql` — the `meal_entries`, `foods` and `meal_goals` tables, locked to each user by row-level security

## Add to your iPhone home screen

Open the site in Safari, tap Share, then **Add to Home Screen**. The camera works from the home-screen version for both photos and barcodes.
