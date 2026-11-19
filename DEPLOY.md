# Deploying Almagest (Render app + Render Postgres + MongoDB Atlas, free tiers)

**Fast path (2 accounts):** `render.yaml` now creates a Render Postgres and wires `DATABASE_URL` for you, so skip section 1 (Neon) and paste only `MONGODB_URI`. Neon remains an alternative if Render's free Postgres is unavailable: remove the `databases:` block and set `DATABASE_URL` yourself.

About 25 minutes the first time. Do the steps in order. Your code goes to GitHub, Render pulls it from there.

## 0. Push the code to GitHub
```bash
cd almagest-pro
git init && git add . && git commit -m "Almagest"   # .env is git-ignored; never commit it
# create an empty repo on github.com (e.g. almagest), then:
git branch -M main
git remote add origin https://github.com/<you>/almagest.git
git push -u origin main
```
Check there is a `.gitignore` containing `node_modules` and `.env` before the first commit.

## 1. PostgreSQL on Neon
1. neon.tech → sign up → **Create project** (name `almagest`, region closest to you, e.g. Singapore).
2. On the dashboard click **Connect** and copy the connection string. It looks like
   `postgresql://user:pass@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.
   Keep `?sslmode=require`. This is your `DATABASE_URL`.

Tables and the object catalog are created automatically on first boot (`AUTO_SETUP=1`).

## 2. MongoDB on Atlas
1. cloud.mongodb.com → sign up → **Create** a free **M0** cluster (any region).
2. **Database Access** → Add user (username + password; avoid `@ : / ?` in the password or URL-encode them).
3. **Network Access** → Add IP address → **Allow access from anywhere (0.0.0.0/0)**. Render's free tier has no fixed IP, so this is required.
4. **Connect → Drivers** → copy the string, e.g. `mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`.
   Replace `<password>`. This is your `MONGODB_URI`.

## 3. Web service on Render
1. render.com → sign up with GitHub → **New → Blueprint** → pick your repo. Render reads `render.yaml`.
   (Or **New → Web Service**: runtime Node, build `npm ci --omit=dev`, start `node server.js`, plan Free.)
2. When asked, paste `DATABASE_URL` and `MONGODB_URI`. `JWT_SECRET` is generated for you. Other variables are preset:
   `NODE_ENV=production`, `TRUST_PROXY=1`, `AUTO_SETUP=1`, `MONGODB_DB=almagest`.
3. Deploy. First build takes 2 to 4 minutes. Open `https://<name>.onrender.com/api/health`.
   You want `{"status":"ok","db":"up","mongo":"up"}`.

## 4. Load the demo data
```bash
node scripts/seed-demo.js https://<name>.onrender.com
```
Login: `demo@almagest.dev` / `DemoPass123`.

## Things that will bite you
- **Cold start.** The free web service sleeps after about 15 minutes idle and takes about 50 s to wake. **Open the site 5 minutes before the demo** and click through once.
- **`/api/health` shows `mongo: down`.** Atlas Network Access is missing 0.0.0.0/0, or the password has unencoded special characters.
- **Login works but you are logged out on every request.** `TRUST_PROXY` is not set to 1, or `NODE_ENV` is not `production` (the cookie is `Secure` in production, so you must use the `https://` URL).
- **Build fails on `npm ci`.** Commit `package-lock.json`.
- **Neon first query is slow.** The compute suspends when idle; the first request after a pause takes a second or two.
- Free tiers can change. If a screen differs from the above, the concept is the same: one Postgres URL, one Mongo URL, one Node web service.

## Fallback if cloud setup fails before the demo
Run it locally and show it on your laptop: `brew services start postgresql mongodb-community`, `npm run setup && npm start`, then `node scripts/seed-demo.js`. Say in the demo that the cloud config (`render.yaml`, `DEPLOY.md`) is ready and tested locally in production mode.
