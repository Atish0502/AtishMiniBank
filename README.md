# MiniBank

A modern mini banking web application built with Node.js, Express, MongoDB Atlas, and a clean frontend UI. It supports core banking operations like account creation, deposits, withdrawals, transfers, balance lookup, transaction tracking, and admin access.

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
* MongoDB Atlas integration
* Render deployment ready

## Tech Stack

* **Frontend:** HTML, CSS, JavaScript
* **Backend:** Node.js, Express
* **Database:** MongoDB Atlas
* **Deployment:** Render
* **Tools:** Git, GitHub, VS Code

## Demo

Live demo: [https://latestadvancedbankwebsite.onrender.com](https://latestadvancedbankwebsite.onrender.com)

## Screenshots
The starting sign up/Login Page
<img width="959" height="466" alt="image" src="https://github.com/user-attachments/assets/332b0b3a-85a4-46a1-b215-940ab1a7b771" />


Toggling dark and light mode
<img width="947" height="428" alt="image" src="https://github.com/user-attachments/assets/b7897402-fc03-4701-ae6d-9fa9e590b45f" />
<img width="959" height="445" alt="image" src="https://github.com/user-attachments/assets/4f945294-1197-4db8-bdb3-0ff70553869d" />


Dashboard--><img width="959" height="430" alt="image" src="https://github.com/user-attachments/assets/75e0f291-a06a-4ca7-8f40-65c70fe6c8ad" />
Accounts--><img width="955" height="434" alt="image" src="https://github.com/user-attachments/assets/c0dbf2ff-a2a2-45d2-af94-80284513ebe1" />

Transactions--><img width="959" height="416" alt="image" src="https://github.com/user-attachments/assets/a31fa7a5-794c-4498-9791-5a1159cdabe2" />


Fds--><img width="955" height="430" alt="image" src="https://github.com/user-attachments/assets/8ccfe7cc-57ac-411a-8d2c-194385ea31c6" />

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
git clone https://github.com/Atish0502/latestAdvancedBankWebsite.git
cd latestAdvancedBankWebsite
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root and add:

```env
MONGODB_URI=your_mongodb_atlas_connection_string
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

* `MONGODB_URI` — MongoDB Atlas connection string
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
* If you change database schema or indexes, make sure the Atlas collection data is compatible.

## Troubleshooting

### MongoDB index or duplicate key error

If deployment fails because of a duplicate key error, check the existing documents in MongoDB Atlas and remove conflicting data or update the index logic.

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
