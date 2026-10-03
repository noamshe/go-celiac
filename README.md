# ביחד · Go Celiac

Hebrew RTL community PWA with a Node.js server, SQLite persistence, image uploads and live WebSocket updates.

## Run

Requires Node.js 24 or later.

```sh
npm install
npm run build
npm start
```

Open `http://localhost:4173`. On another device on the same network, use this computer's LAN address with port 4173. Keep the server running. Both the app and API use the same origin, and HTTP LAN URLs support the live community flow.

For UI development, keep the backend running and run `npm run dev` in a second terminal. Vite proxies API, upload and WebSocket requests to port 4173.

## Live behavior

- Onboarding saves a display name and generated profile UUID in `localStorage` under `beyachad.profile.v1`. Names may repeat; the UUID is the identity key. Renaming preserves it. Profiles are self-declared, not authenticated accounts, and different devices create different IDs unless they use the same saved profile.
- Questions accept text and up to six PNG, JPEG, GIF or WebP photos, up to 5MB per image and 20MB total request size. Sending persists the question and broadcasts to connected users except the sender's ID.
- The help list shows other users' questions newest first, with live questions inserted at the top. Rounded green-and-white cards show names, sender IDs, dates and photos on the question side and answer choices on the other side. Swipe horizontally or use the buttons to switch back and forth; vertical scrolling and multi-photo gallery scrolling remain available. Card sides are preserved during live updates. The help badge counts questions that the current profile has not answered. Answered questions remain visible with a confirmation.
- Each question offers six answer choices with optional text in a modal. A profile may answer a question once. Answers are persisted and delivered only to the question owner. Retrying the same question/answer does not duplicate it.
- The need-help badge counts unread answers. Tapping it opens the owner's questions and replies; viewing the inbox acknowledges displayed replies as read. The home screen also has a link to past questions and replies and the inbox has a new-question button.
- A live toast announces incoming questions and answers. The socket reconnects automatically and receives a fresh snapshot, including anything missed while disconnected. Closed apps receive updates when reopened; these live messages are not background Web Push.

## Storage and deployment

The default `data/` directory contains `community.sqlite` and `uploads/`. Keep and back up the entire directory, including SQLite WAL files when the server is running. Set `DATA_DIR` to a persistent absolute directory if deploying; use `PORT` to override port 4173. Test data uses separate temporary directories under `artifacts/`.

Deploy the Node server with a persistent disk and a proxy supporting WebSocket upgrades. Serve over HTTPS for PWA installation, camera APIs and native notification testing. Deploying only `dist/` to static hosting will not provide the live backend. The existing optional notification permission and local test notification remain available; notification taps open `/#help`. Remote Web Push subscriptions and authentication are not implemented.

The service worker caches the app shell and viewed images; API responses are never cached. Sending requires a connection and failed submissions retain their photo/text draft for retry. The font uses Google Fonts with a local fallback.

## Verification

```sh
npm run build
npm run test:live
```

The automated browser test starts an isolated server and three browser profiles, checks question/photo delivery, sender exclusion, chronological ordering, answers, badge counts, read acknowledgments, reconnect catch-up and database/photo persistence across a server restart.
