# Fonts

## DM Sans (bundled)
`DMSans-Regular.woff2` / `DMSans-Medium.woff2` — open-source (SIL OFL), used for
the "Dashboard" wordmark on the splash and available as a UI fallback.

## Nohemi (NOT bundled — add your licensed copy)
The splash renders "Zealer" in **Nohemi SemiBold**. Nohemi is a commercial font
(Pangram Pangram) and is not distributed with this repo.

To enable it: drop your licensed **`Nohemi-SemiBold.woff2`** into this `fonts/`
folder. The `@font-face` rule in `styles.css` already points here and will pick
it up automatically. Until then, "Zealer" falls back to DM Sans 500 / a system
geometric sans, so the splash still looks clean.
