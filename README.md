MiniBank Demo

1. Install deps: `npm install`
2. Ensure MongoDB running locally on mongodb://127.0.0.1:27017
3. Start server: `npm start`
4. Open http://localhost:3000 in your browser

This frontend is a simple demo UI wired to the existing backend endpoints:
- POST /create-account
- POST /deposit
- GET /balance/:acc
- POST /withdraw
- POST /transfer
- GET /transactions
