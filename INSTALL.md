# Cost Management — install on Android

Files in this folder go into the root of your Cost_management repo (same level as index.html):

    index.html                ← updated: manifest link, theme colour, icon in header, service-worker registration
    manifest.webmanifest      ← app name, colours, fullscreen, icons
    sw.js                     ← offline: caches app shell + last Supabase data
    icons/                    ← all icon sizes (PNG + SVG)

Steps
1. Copy everything into the repo, commit, push. GitHub Pages redeploys in ~1 min.
2. On Android, open https://celeritas7.github.io/Cost_management/ in Chrome.
3. Chrome shows "Install app" (⋮ menu → Install app, or the banner). Tap it.
4. The Orbit icon appears on the home screen; it opens fullscreen with a plum status bar.

Notes
- Offline: the app opens and shows the last loaded expenses. Adding still needs signal.
- After you push future changes, bump `cm-shell-v1` → `v2` in sw.js so phones fetch the new build.
- If you already had the page bookmarked, remove it and reinstall to get the icon.
