# PERFORMANCE LAB

A training and recovery log with a daily readiness score, trend charts and four AI coaches (Strength, Recovery, Sleep, Nutrition) that read your logged data.

- **Front end:** `index.html` + `config.js`. Static files with no build step.
- **Backend:** Supabase project `iiqczlutqezylppckecc`.
  - `public.days`: one row per user per day. Row-level security limits each user to their own rows.
  - Edge Function `coach`: checks the user's session, reads their last 14 days and streams a Claude reply.
  - Auth: email magic link.

## Finish setup

1. **Anthropic key for the coaches.** In Supabase, go to Edge Functions → Secrets and add `ANTHROPIC_API_KEY`. Optionally add `COACH_MODEL` to override the default model.
2. **Sign-in redirect.** Go to Authentication → URL Configuration. Set **Site URL** to wherever you host the app, and add that URL (plus `http://localhost:8000` for local testing) under Redirect URLs.
3. **Run locally:** `python3 -m http.server 8000`, then open http://localhost:8000.
4. **Deploy:** upload `index.html` and `config.js` to any static host, such as Netlify, Vercel, Cloudflare Pages or GitHub Pages.

The publishable key in `config.js` is meant to be public. Never put the service-role key or the Anthropic key in front-end files.
