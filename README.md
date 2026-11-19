# Almagest: final project

A production-style astronomy portal for amateur observers. It computes what is actually in your sky, filters it by what your equipment and sky can physically show, and ranks targets with a model that **learns from your own ratings and observation logs**.

It runs alongside the lab experiments on its own port and its own database:

| What | Port | Database |
|---|---|---|
| Exp 4: PHP + MySQL observation log | Apache (XAMPP) | MySQL `almagest` |
| Exp 5: Node + Postgres events API | 3000 | Postgres `almagest` |
| Lab: RESTful catalog API | 3001 | in-memory |
| AI session planner (rule-based) | 3002 | none |
| Old static frontend | 5500 (Live Server) | none |
| **Almagest (this project)** | **4000** | **Postgres `almagest_prod` + MongoDB `almagest_prod`** |

Nothing here reads or writes the experiments' databases.

---

## 1. Run it on your Mac

You need Node.js 18 or newer, Postgres.app running (the same one Exp 5 uses), and MongoDB running locally (step 0 below).

### 0. Install and start MongoDB (once, on your Mac)

```bash
brew tap mongodb/brew
brew install mongodb-community mongosh
brew services start mongodb-community     # starts it now and on every login
mongosh --eval "db.runCommand({ping:1})"  # should print { ok: 1 }
```
If you don't have Homebrew, install it from https://brew.sh first. MongoDB listens on `127.0.0.1:27017` by default, which is what `.env.example` already uses.

### 1. Set up and run

```bash
cd ~/Desktop/almagest-pro          # wherever you unzipped it
npm install
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#   paste that output after JWT_SECRET= in .env
npm run setup                      # creates almagest_prod, builds tables, seeds the catalog
npm start
```

Open **http://localhost:4000**. Create an account, set your location and telescope on the Profile page, then go to Plan.

Other commands:

```bash
npm test          # 24 automated tests (uses separate almagest_test databases in both Postgres and MongoDB)
npm run simulate  # offline evaluation of the recommender (see section 4)
npm run migrate:mongo  # only if you used the earlier version: copies its logbook into MongoDB
npm run dev       # auto-restarts when you edit files
```

### If something goes wrong

| Message | Fix |
|---|---|
| `password authentication failed` | Put your real Postgres password in `DATABASE_URL` in `.env`. Exp 5 used `postgres` / `almagest`. |
| `role "postgres" does not exist` | Postgres.app's default user is your Mac username: `DATABASE_URL=postgres://aravindanand@localhost:5432/almagest_prod` |
| `EADDRINUSE :4000` | `lsof -ti:4000 \| xargs kill -9`, then `npm start` again |
| `Could not connect to PostgreSQL` | Open Postgres.app and click Start |
| `Cannot reach MongoDB at …` | `brew services start mongodb-community`, then `npm start` again |
| `brew: command not found` | Install Homebrew from https://brew.sh |
| `mongosh: command not found` | `brew install mongosh` |
| Logged out after restarting the server | `JWT_SECRET` isn't set in `.env` |

---

## 2. Features

- **Tonight dashboard**: Moon phase and illumination, when astronomical darkness starts and ends, live top picks, upcoming sky events and your observing stats.
- **Session planner**: hard physical filters (altitude, your limiting magnitude, darkness), then a learned ranking with a plain-English explanation for every pick, thumbs up/down, and one clearly labelled *exploration pick*. If you ask for a daytime slot, it moves the plan to tonight's darkness.
- **Catalog**: 42 Messier/NGC showpieces plus the 7 planets. Search and filter them, see live altitude, and view a 12-hour altitude chart with the dark hours shaded.
- **Logbook**: create, edit and delete observations, with seeing, transparency, a rating and notes. Rated logs of catalog objects train the recommender. A plausibility check warns when the logged object was below the horizon at that time and place, which usually means a time-zone mistake.
- **Events**: Moon phases, solar and lunar eclipses, planetary oppositions, greatest elongations and meteor-shower peaks, computed for the next 120 days. Users can also post star parties and RSVP; only the host can cancel.
- **Identify**: the trained neural-network image classifier from the earlier experiment, running in the browser.
- **Orbits**: the 3D solar-system and sky-dome viewer.
- **Profile**: your observing setup, plus a transparent view of what the model has learned about you, with a one-click reset.
- **Accounts**: sign-up and sign-in with bcrypt-hashed passwords and an HTTP-only JWT cookie. Every logbook entry and event is scoped to its owner.

## 2b. How the two databases split the work

| PostgreSQL (relational, constrained) | MongoDB (documents) |
|---|---|
| users and password hashes | **observation logbook** |
| profiles (location, Bortle, aperture) | **recommender training examples** |
| the object catalog | |
| community events and RSVPs | |
| recommender weights (global + per user) | |

Why this split:
- **The logbook is document-shaped.** Each observation is one self-contained document with nested `location` and `conditions`, the object's name and type copied in, and free-form notes. Adding a field later (e.g. eyepiece, filters) needs no migration.
- **Training examples are append-only records** of `{userId, objectId, features[15], label, source, time}`: a natural fit for a document store.
- **Users, the catalog and events are relational.** They need unique emails, foreign keys, cascades and joins, which PostgreSQL enforces and MongoDB doesn't.
- **Model weights stay in PostgreSQL** because they are updated under row locks inside a transaction.

Consequences you should know about (good viva material):
- **No cross-database transactions.** Saving feedback writes to MongoDB first, then updates the weights in PostgreSQL. If the second step fails, the example exists but the global weights missed one update; the user's personal model self-heals on the next refit because it is rebuilt from the stored examples.
- **No foreign-key cascades across databases.** Deleting an observation deletes its training example in code, not by constraint.
- **Aggregation.** `GET /api/observations/insights` runs MongoDB `$match` + `$group` pipelines over your own logbook (rating by seeing, by transparency, by object type, by target). Averages are derived from `$group` counts per rating value, which uses only the most basic accumulator.

Data model (one `observations` document):
```json
{ "_id": "ObjectId", "userId": 1, "objectId": 16, "objectType": "galaxy", "targetName": "Andromeda Galaxy",
  "observedAt": "2026-10-15T15:30:00Z", "location": { "lat": 12.82, "lon": 80.04 },
  "conditions": { "seeing": 4, "transparency": 4 }, "rating": 5, "equipment": "8-inch Dobsonian",
  "notes": "Dust lane visible", "createdAt": "…" }
```
You can browse it in `mongosh` (`use almagest_prod`, then `db.observations.find().pretty()`) or in MongoDB Compass.

## 3. Where the AI is, and why it isn't a wrapper

There is no LLM and no API key. The recommender is a learning system built for this problem.

1. **Physics first.** Positions come from [astronomy-engine](https://github.com/cosinekitty/astronomy) (VSOP87 planets, ELP lunar theory, precession and nutation). An object is only a candidate if it is above your minimum altitude and brighter than your limiting magnitude. That limit is estimated from your Bortle class and aperture as NELM + 5·log₁₀(D / 7 mm).
2. **Features.** Each feasible candidate becomes a 15-number feature vector: object type, altitude, margin inside your limit, moonlight interference (illumination × Moon up × angular proximity × faintness), surface dimness under your sky, apparent size, novelty to you, and faintness relative to your experience.
3. **Model.** The predicted enjoyment is `p = σ((w_global + δ_user) · x)`, a hierarchical logistic regression.
   - `w_global` is shared by everyone. It is updated online by SGD on every new example and regularised toward an astronomy-informed prior, so a brand-new install still makes sensible picks.
   - `δ_user` is your personal offset. It is L2-regularised toward zero, so a new user gets the community model and moves away from it only as fast as their own evidence allows.
4. **Training data.**
   - Thumbs up or down on a pick gives a label of 1 or 0.
   - A logged observation with a rating from 1 to 5 gives a soft label of (rating − 1) / 4.
   - Features are always recomputed on the server from the stored time and place, never taken from the browser.
   - Every example is stored in the `feedback` table. Your personal model is refit from that table whenever a log is edited or deleted, so it always matches your data.
5. **Exploration.** Four picks exploit the model. The fifth uses a UCB-style bonus that shrinks as you rate more objects of a type, so the system keeps learning instead of showing you only what it already thinks you like.
6. **Explanations.** Each reason shown on a pick is the contribution of one weighted feature. Reasons that come from *your* ratings are highlighted in gold, and when your ratings have flipped a factor's usual direction the text says so.

## 4. Evaluation

**Astronomy accuracy.** The tests cross-check positions against astropy:
- deep-sky and planet altitudes agree within 0.02°;
- Moon illumination agrees within 0.5 percentage points;
- the computed events include the real 6 Feb 2027 annular solar eclipse and the Feb 2027 oppositions of Jupiter and Mars.

**Recommender (simulated users).** `npm run simulate` runs 150 simulated observers × 15 sessions. Each user has hidden true preferences: the prior, plus a population-wide shift, plus personal taste. Each session the system recommends 5 targets, the simulated user rates them, and the system learns. P@5 means overlap with the oracle's top 5.

Results over three seeds:

| Method | P@5, sessions 1–3 | P@5, sessions 11–15 | Satisfaction / oracle, 11–15 |
|---|---|---|---|
| Random feasible | 0.34–0.37 | 0.34–0.38 | 0.78–0.80 |
| Rule prior, no learning | 0.65–0.67 | 0.64–0.66 | 0.94 |
| Global model only | 0.65–0.68 | 0.65–0.67 | 0.94–0.95 |
| Per-user model only | 0.66–0.67 | 0.70 | 0.96 |
| **Hierarchical (Almagest)** | 0.66–0.68 | **0.70–0.71** | **0.96–0.97** |

What these results do and don't show:
- **Physics filtering does most of the work.** It takes P@5 from about 0.35 (random) to about 0.65 (rule prior).
- **Learning adds about 5 more points over 15 sessions.**
- **The shared global component adds little on top of per-user learning in this simulation.** Treat the hierarchical vs per-user difference as within noise.
- **This is a simulation.** It shows that the learning loop works and converges. It says nothing about what real observers enjoy; that needs a user study with real logs.

## 5. Production practices in the code

- **Security**
  - Parameterised SQL everywhere.
  - Zod validation on every input, with field-level errors shown in the UI.
  - bcrypt (11 rounds); login takes the same time and returns the same error for unknown email and wrong password, so it doesn't reveal which emails are registered.
  - HTTP-only, SameSite=Lax cookie.
  - Helmet with a strict Content Security Policy (no inline scripts).
  - Rate limiting: 20 auth attempts per 15 minutes and 300 API calls per minute.
  - The DOM is built with `textContent`, so user text can't inject HTML.
- **Data integrity**
  - Versioned SQL migrations.
  - CHECK constraints and foreign keys with cascades.
  - Transactions with row locks (`FOR UPDATE`) around model updates.
- **Operations**
  - Structured JSON request logs with request IDs.
  - A central error handler that never leaks stack traces.
  - `/api/health`.
  - Graceful shutdown.
  - Configuration through `.env`.
- **Tests**: unit tests (astronomy against astropy, model maths, ranking constraints) and API tests (auth, ownership, validation, learning, events), run against a separate test database.

## 6. API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | /api/auth/signup · /login · /logout | – | Accounts |
| GET | /api/auth/me | ✓ | Current user |
| GET / PUT | /api/profile | ✓ | Location, Bortle, aperture, experience, min altitude |
| GET | /api/objects?q&type&lat&lon | – | Catalog with live altitude |
| GET | /api/objects/:slug/track?lat&lon&hours | – | Altitude curve |
| POST | /api/plan | optional | Recommendations (personalised when signed in) |
| GET | /api/tonight | optional | Moon and darkness summary |
| POST | /api/feedback | ✓ | Thumbs up/down → online learning |
| GET / DELETE | /api/model/me | ✓ | Inspect or reset your personal model |
| GET / POST / PUT / DELETE | /api/observations[/:id] | ✓ | Logbook (owner-only) |
| GET | /api/observations/stats | ✓ | Totals and per-type stats |
| GET | /api/observations/insights | ✓ | MongoDB aggregation: rating by conditions, type and target |
| GET | /api/events/sky?days | – | Computed sky events |
| GET / POST | /api/events/community | optional / ✓ | Star parties |
| POST | /api/events/community/:id/rsvp | ✓ | Toggle RSVP |
| DELETE | /api/events/community/:id | ✓ host | Cancel an event |
| GET | /api/health | – | Liveness; checks both PostgreSQL and MongoDB |

## 7. Project layout

```
server.js                 entry point (port 4000)
src/app.js                Express app: security middleware, routes, static files
src/astro/sky.js          positions, Moon, twilight, limiting magnitude
src/astro/events.js       eclipses, oppositions, elongations, Moon phases, meteor showers
src/ml/model.js           features, prior, logistic model, SGD update
src/ml/recommender.js     feasibility filter, ranking, exploration, explanations
src/mongo.js              MongoDB connection and indexes
src/services/…            database side of learning (examples in MongoDB, weights in PostgreSQL)
scripts/migrate-to-mongo.js  one-time copy of an older logbook into MongoDB
src/routes/…              REST endpoints
db/migrations/*.sql       schema
db/catalog.js             seed catalog (J2000 coordinates)
scripts/simulate.js       offline recommender evaluation
test/*.test.js            node:test + supertest
public/                   frontend (vanilla JS, no build step)
```

## 8. Optional: train a better image model on your GPU

The Identify page's browser model is trained only on synthetic images. For a model trained on **real galaxy photos**, follow `ml-galaxy/README.md` (Windows + NVIDIA GPU). It fine-tunes a pretrained CNN on the Galaxy10 DECaLS dataset, reports honest held-out test metrics, and exports an ONNX file that the server loads. Until you do, the Galaxy card on the Identify page says it isn't installed and everything else works as before.

## 9. Honest limitations

- **The catalog is small.** It has 49 objects. Coordinates are standard J2000 values, but they were typed in by hand, so spot-check any you rely on.
- **The limiting-magnitude model is a rule of thumb.** Real visibility of extended objects also depends on surface brightness, magnification and the observer's eyes.
- **Meteor-shower dates are approximate.** They are fixed calendar dates, accurate to about a day.
- **The recommender's evidence is simulated** (section 4). The image classifier is trained on synthetic images only and has no "none of these" class.
- **The MongoDB code was tested against FerretDB, not a real `mongod`.** MongoDB's download is blocked in the environment where this was built, so the automated tests ran against FerretDB 1.24, a MongoDB-compatible server. The queries use only standard operations (`find`, `insertOne`, `findOneAndUpdate`, `deleteMany`, `aggregate` with `$match` and `$group` with `$sum: 1`), so they should behave identically on real MongoDB, but run `npm test` on your Mac once to confirm.
- **This is a single-server setup.** Rate limits are kept in memory per process, and there are no email verification or password-reset flows.

## Ask Almagest (assistant) and cloud deployment
- `/assistant.html` and `POST /api/assistant`: grounded assistant (TF-IDF intent classifier + entity extraction + calls to the ephemeris, recommender, event calculator and logbook). Code in `src/ai/`; evaluation: `node scripts/eval-intents.js`.
- `DEPLOY.md`: Render + Neon + Atlas steps. `render.yaml` is the Render blueprint. `AUTO_SETUP=1` migrates and seeds on boot.
- `DEMO.md`: demo script and likely questions. `node scripts/seed-demo.js <url>` creates the demo account.
