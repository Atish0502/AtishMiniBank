MiniBank

MiniBank is a small demo bank app (Express + MongoDB). It supports signup/login, admin login, deposits, withdrawals, transfers and transaction recording.

Local setup
1. Copy `.env.example` to `.env` and fill values (do NOT commit `.env`).
2. Install dependencies:
```powershell
npm install
```
3. Run locally:
```powershell
node server.js
```
4. Open http://localhost:3000

Deploying to Render
1. Push your repository to GitHub and create a new Web Service on Render.
2. In the Render dashboard for your service, add the following Environment Variables:
	- `MONGODB_URI` — your Atlas connection string (e.g. mongodb+srv://<user>:<password>@cluster0.../bankDB?retryWrites=true&w=majority)
	- `ADMIN_PASSWORD` — (optional) admin password (overrides default `atish1997`).
3. Start Command (Render): `npm start`.
4. Render will set `PORT` automatically; the server uses `process.env.PORT`.

Security
- Never commit credentials or `.env` to source control. Use Render's environment variables to keep secrets private.
- If your Atlas password contains special characters, URL-encode it before placing into the connection string.

If you want, I can also:
- Add a `render.yaml` manifest for one-click deployments.
- Walk you through adding the env vars in the Render UI step-by-step.
