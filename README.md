# Sirius Global — Frontend + Backend

## Run (Node.js, no npm packages required)

```bash
cd backend
node server.js
```

Open:
- Site: http://localhost:3000
- Admin: http://localhost:3000/admin

**Admin credentials:** `admin@sirius.local` / `Admin123!`

## Features

- Registration & login (JWT-like HMAC tokens, scrypt passwords)
- Deposit requests → admin approve credits balance
- Withdrawal requests (fee $8.50) → funds held → admin paid/reject (refund)
- Admin panel: pending deposits, withdrawals, users list
- Data stored in `backend/data/sirius.json`

## Production

Set env vars:
- `PORT=3000`
- `JWT_SECRET=long-random-string`
- `DEPOSIT_WALLET=your_trc20_address`

## Frontend

- Tilda removed
- CSS bundled: `assets/css/sg-bundle.css`
- `CONFIG.USE_BACKEND = true` talks to same-origin `/api/v1/*`
