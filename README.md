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
- A live toast announces incoming questions and answers. The socket reconnects automatically and receives a fresh snapshot, including anything missed while disconnected. The deployed Atlas backend also sends Web Push to opted-in devices for questions from other users and replies to their own questions, including when the app is closed.

## Storage and deployment

The default `data/` directory contains `community.sqlite` and `uploads/`. Keep and back up the entire directory, including SQLite WAL files when the server is running. Set `DATA_DIR` to a persistent absolute directory if deploying; use `PORT` to override port 4173. Test data uses separate temporary directories under `artifacts/`.

Deploy the local SQLite Node server with a persistent disk and a proxy supporting WebSocket upgrades. Serve over HTTPS for PWA installation and camera APIs. Deploying only `dist/` to static hosting will not provide the live backend. Web Push is implemented in the Atlas deployment; the local SQLite server does not expose its push endpoints. Authentication is not implemented.

The service worker caches the app shell and viewed images; API responses are never cached. Sending requires a connection and failed submissions retain their photo/text draft for retry. The font uses Google Fonts with a local fallback.

## Vercel

The root Vercel deployment builds the UI and deploys `api/server.mjs`. MongoDB Atlas stores profiles, questions, answers, events and photo binaries. Only `MONGODB_URI` is required in the production server environment; no Blob store is needed. Never prefix this secret with `VITE_` or commit it. The database is explicitly named **go-celiac-db**, overriding any default database in the connection URL. Collections and indexes initialize automatically; other databases are not modified. The Atlas database user needs read/write access to go-celiac-db, and Atlas Network Access must allow connections from the deployment. Local SQLite data is not migrated.

Enable Fluid compute for the project's functions. WebSocket connections reconnect when the function reaches its maximum duration. A durable MongoDB event log coordinates updates across function instances; live clients check it every 1.5 seconds. Database writes and events commit together using Atlas transactions. Photos upload one at a time, with a 2 MiB limit per stored image. Larger photos are resized and compressed in the browser before upload, so each request and image response stays under Vercel's payload limit. Small photos remain unchanged; compressed GIFs become still JPEGs. Photo retries reuse the same ID, and only published question photos are served. `/api/health` reports database availability, its name and photo storage readiness.

## Web Push

Open the HTTPS app and tap **אפשר התראות במכשיר הזה** on the welcome or home screen. On iPhone/iPad (16.4+), add the PWA to the Home Screen and open that installed app first. Permission is optional and requested only after a tap. An opt-in before entering a name is attached to the profile after onboarding. Existing subscriptions are reattached when the app reconnects.

In the help screen, **שלח התראת ניסיון** sends a real server-originated push to that profile's subscribed devices. New questions notify other subscribed profiles; replies notify only the question owner. Notification taps open the help list or reply inbox. Retries do not duplicate pushes for already saved questions or answers. Delivery depends on the browser push provider, connection and device notification settings; the app still works if a push fails.

VAPID signing keys are generated once and stored privately in `go-celiac-db.settings`; only the public key is returned to browsers. No additional environment variables are needed. Subscriptions are stored per endpoint, and expired endpoints are removed after provider errors. Keep the settings collection when backing up the database so subscriptions remain valid.

## Verification

```sh
npm run build
npm run test:live
npm run test:cloud
```

The automated browser test starts an isolated server and three browser profiles, checks question/photo delivery, sender exclusion, chronological ordering, answers, badge counts, read acknowledgments, reconnect catch-up and database/photo persistence across a server restart.

The cloud test uses an isolated MongoDB replica set with the real driver and transactions. It checks API routes, WebSocket delivery, ownership, retries, concurrent writes, binary photo delivery, rejected invalid/oversized uploads, photo reservation limits, reconnect persistence and isolation from another database. The first run downloads a MongoDB test binary.
