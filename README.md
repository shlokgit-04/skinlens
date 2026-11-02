# SkinLens

AI skin analysis from your webcam, built on Perfect Corp's **YouCam Skin Analysis API**
for the YouCam API Skin AI & eCommerce VTO Hackathon.

One front-facing selfie → eight HD skin-concern scores (wrinkles, pores, texture, acne,
redness, hydration, dark circles, radiance) plus the engine's detection masks, overlaid
on your photo with one tap.

## Stack
- **Frontend** — static HTML/CSS/JS: webcam capture (getUserMedia), 3-2-1 countdown,
  results dashboard with per-concern score bars and mask overlay. File upload fallback
  when no camera is available.
- **Backend** — small Flask proxy (`backend.py`) so the YouCam API key never touches the
  browser: init upload → pre-signed PUT → `v2.1/task/skin-analysis` → poll → results.
- **Hosting** — any Python host; env var `YOUCAM_API_KEY` holds the API key.

## Run locally
```
pip install -r requirements.txt
YOUCAM_API_KEY=your_key python backend.py
```

## Notes
- Scores are 0–100 as returned by the YouCam engine; SkinLens displays them as-is.
- Skin scores are cosmetic estimates, not a medical diagnosis.
- No fabricated data: the app renders only what the API actually returns, with honest
  error states when the engine fails.
