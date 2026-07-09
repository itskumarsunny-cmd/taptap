# TapTap Backend

Node.js/Express + Socket.io backend for **TapTap** — random video/text matching, gender & country
filters, follows, mutual-follow private calls, persistent DMs, and Premium subscriptions.

Powers the frontend pages: `index.html`, `login.html`, `register.html`, `chat.html`, `history.html`,
`follows.html`, `messages.html`, `premium.html`.

## Stack

- Express (REST API)
- Socket.io (matchmaking, WebRTC signaling, private calls, live DMs)
- MongoDB / Mongoose (users, follows, conversations, messages, match history)
- JWT auth (`jsonwebtoken`) + `bcryptjs` password hashing

## Setup

```bash
npm install
cp .env.example .env   # then fill in the values below
npm start               # or: npm run dev (nodemon)
```

## Environment variables

| Variable        | Required | Description                                                                 |
|-----------------|----------|-------------------------------------------------------------------------------|
| `MONGODB_URI`   | yes      | MongoDB connection string (e.g. from MongoDB Atlas)                          |
| `JWT_SECRET`    | yes      | Long random string used to sign auth tokens                                  |
| `FRONTEND_URL`  | recommended | Your deployed frontend origin (e.g. `https://taptap.example.com`), used for CORS. Defaults to `*` if unset. |
| `PORT`          | no       | Port to listen on (Railway/Render/etc. set this automatically)               |

Create a `.env` file locally:

```
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/taptap
JWT_SECRET=replace-with-a-long-random-string
FRONTEND_URL=https://your-frontend-domain.com
PORT=3000
```

## Deploying (Railway, Render, etc.)

1. Push this repo to GitHub.
2. Create a new service from the repo on your host (Railway/Render/Fly/etc.).
3. Set the environment variables above in the host's dashboard.
4. Build/start command: `npm install && npm start` (most hosts auto-detect this from
   `package.json`).
5. Point your frontend's `config.js` `API_URL` at the deployed URL.

> Make sure `FRONTEND_URL` matches exactly where your frontend is hosted, or the browser will
> block requests via CORS.

## REST API

All authenticated routes expect `Authorization: Bearer <token>`.

| Method | Route                              | Auth | Description                                    |
|--------|-------------------------------------|------|-------------------------------------------------|
| GET    | `/`                                  | no   | Health check                                    |
| GET    | `/api/countries`                     | no   | List of countries (`{code,name,flag}`)          |
| POST   | `/api/register`                      | no   | `{username,email,password,gender,countryCode}`  |
| POST   | `/api/login`                         | no   | `{email,password}`                              |
| GET    | `/api/me`                            | yes  | Current user profile                            |
| GET    | `/api/stats`                         | no   | Live online/waiting counts                      |
| POST   | `/api/premium/activate`              | yes  | `{plan: 'monthly'|'annual'}` → activates Premium|
| POST   | `/api/follow/:id`                    | yes  | Follow a user → `{success, mutual}`             |
| DELETE | `/api/follow/:id`                    | yes  | Unfollow a user                                 |
| GET    | `/api/follow/status/:id`             | yes  | `{iFollow}`                                     |
| GET    | `/api/following`                     | yes  | Users you follow                                |
| GET    | `/api/followers`                     | yes  | Users following you                             |
| GET    | `/api/mutual-follows`                | yes  | Users who follow you back                       |
| GET    | `/api/history`                       | yes  | Your past matches (last 50)                     |
| POST   | `/api/conversations/start`           | yes  | `{partnerId}` → `{conversationId}` (403 `premium_required` if not mutual/premium) |
| GET    | `/api/conversations`                 | yes  | Your DM inbox                                   |
| GET    | `/api/conversations/:id/messages`    | yes  | Messages in a conversation (marks read)         |
| POST   | `/api/conversations/:id/messages`    | yes  | `{text}` — REST fallback for sending a DM       |

## Socket.io events

**Client → server:** `authenticate`, `find-partner`, `webrtc-offer/answer/ice`, `chat-message`,
`skip`, `report`, `private-call`, `call-answer`, `priv-offer/answer/ice`, `call-end`, `dm-send`.

**Server → client:** `authenticated`, `auth-error`, `waiting`, `partner-found`, `premium-required`,
`partner-left`, `webrtc-offer/answer/ice`, `chat-message`, `stats-update`, `incoming-call`,
`call-ringing`, `call-accepted`, `call-rejected`, `call-ended`, `priv-offer/answer/ice`,
`dm-message`, `dm-notify`.

Gender/country filters on `find-partner` are Premium-gated: a free user requesting a filter gets a
`premium-required` event instead of being queued. Private calls (`private-call`) and DM start
(`/api/conversations/start`) are allowed for Premium users or between mutual followers; otherwise
they're rejected/blocked with a `premium_required` reason so the frontend can redirect to
`premium.html`.

## Data model notes

- **Follow** is directional (`follower` → `following`); a mutual follow is simply both directions
  existing.
- **Conversation** stores exactly 2 participants and a per-user `unread` counter (Mongoose `Map`).
- **MatchHistory** is written for both participants whenever a random-chat pairing ends (skip,
  report, or disconnect), with the actual paired duration in seconds.
