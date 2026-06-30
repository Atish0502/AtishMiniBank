# MiniBank

A modern mini banking web application built with Node.js, Express, Neon PostgreSQL, and a clean frontend UI. It supports core banking operations like account creation, deposits, withdrawals, transfers, balance lookup, transaction tracking, and admin access.

## Features

* Create bank accounts
* Deposit money into an account
* Withdraw money from an account
* Transfer money between accounts
* Check account balance
* View transaction history
* Admin dashboard access
* Session timeout / inactivity logout
* Responsive dark-themed UI
* Neon PostgreSQL database integration
* Render deployment ready

## Tech Stack

* **Frontend:** HTML, CSS, JavaScript
* **Backend:** Node.js, Express
* **Database:** Neon PostgreSQL
* **Deployment:** Render
* **Tools:** Git, GitHub, VS Code

## Demo

Live demo: https://atishminibank.onrender.com/

## Screenshots
The starting sign up/Login Page
<img width="951" height="467" alt="image" src="https://github.com/user-attachments/assets/89b63f4e-6295-4743-981a-f64da9cfff95" />



Toggling dark and light mode
<img width="959" height="435" alt="image" src="https://github.com/user-attachments/assets/efc859c9-e942-4979-8fb2-63e9d6450907" />
<img width="950" height="469" alt="image" src="https://github.com/user-attachments/assets/c3dca8ec-12b4-438c-a61f-5f37b0fa210e" />


Dashboard--><img width="950" height="469" alt="image" src="https://github.com/user-attachments/assets/4fe89171-ec3c-4064-90f3-14c9af7aff0f" />

Accounts--><img width="959" height="384" alt="image" src="https://github.com/user-attachments/assets/6a2a5eb5-337d-4b16-afb4-65368fc4180e" />


Transactions--><img width="959" height="373" alt="image" src="https://github.com/user-attachments/assets/eac3a3bb-1eea-424d-a2f6-f199614970f8" />


Fds--><img width="955" height="430" alt="image" src="https://github.com/user-attachments/assets/8ccfe7cc-57ac-411a-8d2c-194385ea31c6" />
loans--->    <img width="952" height="413" alt="image" src="https://github.com/user-attachments/assets/72076f91-6760-4ad5-acbe-ccef5b14b023" />



<img width="774" height="358" alt="image" src="https://github.com/user-attachments/assets/21af7ed5-073e-4392-aab1-a992167ce095" />





inactivity--><img width="745" height="353" alt="image" src="https://github.com/user-attachments/assets/5a9da11f-f8da-45a3-9077-ce30872e1941" />


and a lot more features just like an advanced bank website



## Project Structure

```bash
latestAdvancedBankWebsite/
├── public/
│   ├── app.js
│   ├── index.html
│   └── style.css
├── scripts/
├── server.js
├── package.json
├── package-lock.json
├── render.yaml
├── .env.example
├── .gitignore
└── README.md
```

## Setup Instructions

### 1. Clone the repository

```bash
git clone https://github.com/Atish0502/AtishMiniBank.git
cd latestAdvancedBankWebsite
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root and add:

```env
DATABASE_URL=your_neon_postgresql_connection_string
PORT=3000
SESSION_SECRET=your_secret_key
```

If your app uses additional variables, add them here as well.

### 4. Run the app locally

```bash
node server.js
```

Then open:

```bash
http://localhost:3000
```

## Environment Variables

* `DATABASE_URL` — Neon PostgreSQL connection string
* `PORT` — server port
* `SESSION_SECRET` — session/authentication secret

## Core Workflow

1. Admin logs in
2. Create a user account
3. Deposit funds
4. Withdraw funds
5. Transfer between accounts
6. Check balance
7. Review transactions

## Deployment on Render

This project is ready for Render deployment.

### Render settings

* **Build Command:** `npm install`
* **Start Command:** `node server.js`

Make sure the Render service has the correct environment variables configured.

## Notes

* `node_modules/` should not be committed to GitHub.
* Keep your `.env` file private.
* If you change database schema or indexes, update the table schema in db.js.

## Troubleshooting

### PostgreSQL unique constraint error

If deployment fails because of a duplicate key or unique constraint error, check the existing records in the database and remove conflicting data.

### App not updating on Render

If GitHub is updated but the live site is not, check the Render deploy logs and confirm the latest commit deployed successfully.

### Port issues

If the server fails to start, ensure the app listens on `process.env.PORT` when available.

## Future Improvements

* Add proper user authentication
* Add beneficiary management
* Add account freeze / unfreeze controls
* Add password reset and OTP flow
* Add analytics and charts for spending
* Add notifications for transactions
* Improve audit logging

## Author

**Atish Paul**

## License

This project is for educational and demo purposes.
