# Jig & Tools Maintenance Traceability System

A sibling system to the Dummy Unit Lot Traceability System, built the same way,
for tracking maintenance jigs and tools (borrow / return / replenish / history),
including a photo per jig/tool.

## How to run

1. Double-click **START_SERVER.bat**
   - OR open terminal in this folder and run:
   - `python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8101 --reload`

2. Wait for: `INFO: Application startup complete`

3. Open browser: http://localhost:8101

4. Hard refresh: Ctrl + Shift + R

---

## Important — before running

Make sure `frontend\img\NXP_logo.png` exists.
Copy your NXP logo image into that folder if missing.

---

## Database

Uses the **same Postgres server and credentials** as the Dummy Unit Traceability
System — but all tables live in their own Postgres **schema** (`jigtools`), so
nothing collides with the dummy-unit app's tables in `public`. The schema and
tables are created automatically on first startup.

**Setup:** copy `.env.example` to `.env` and fill in the real connection
string. `.env` is gitignored — never commit it. The backend loads it
automatically (via `python-dotenv`); docker-compose reads it too (`env_file`).

```bash
cp .env.example .env
# then edit .env with the real DATABASE_URL / DB_SCHEMA
```

This app has its own `technicians` and `admins` tables (in the `jigtools`
schema) — separate from the dummy-unit app's. Register technicians from the
**Register** panel once logged in as admin. Since there's no admin yet on a
fresh schema, insert the first admin directly (pick your own username/password
— don't reuse the dummy-unit app's), e.g.:

```sql
INSERT INTO jigtools.admins (username, full_name, password)
VALUES ('yourusername', 'Your Full Name', 'YourChosenPassword');
```

### Why the jig/tool picture is stored in the database, not on disk

The Postgres server runs on Windows while the app is hosted on Linux — two
separate machines with no shared filesystem between them. Storing the image
as a `bytea` column (served back out via `GET /api/jigs/{id}/image`) avoids
needing an SMB/NFS share or a manual file-sync step between the DB host and
whichever server runs the containers; it "just works" from any host that can
reach Postgres. Images are capped at 5 MB (JPEG/PNG/WEBP/GIF) — see
`backend/app/routers/jigs.py`.

---

## How borrowing works here (vs. the dummy-unit app)

Dummy units are always borrowed as "the whole lot's current quantity."
Jigs/tools are borrowed **in the exact quantity requested** (e.g. borrow 1 of
3 pieces in a lot) — see the `requested_qty` field on `POST /api/request`.

Return condition is tracked as **Good / Damaged / Missing** (no "bent lead" —
that defect type was specific to dummy IC units).

---

## Admin login

No admin is seeded automatically — insert one manually as shown above with
your own credentials.

---

## File structure
```
jig-tools-traceability\
├── START_SERVER.bat          ← double click to start
├── docker-compose.yml
├── docker\
│   ├── Dockerfile.api
│   ├── Dockerfile.frontend
│   └── nginx.conf
├── backend\
│   ├── requirements.txt
│   └── app\
│       ├── main.py
│       ├── database.py
│       ├── models.py
│       ├── schemas.py
│       └── routers\
│           ├── auth.py
│           ├── technicians.py
│           ├── jigs.py          ← master jig/tool catalog + picture upload/serve
│           ├── jig_lots.py      ← lots/batches (qty, location, history)
│           ├── borrow.py        ← borrow/return/approve/reject
│           └── dashboard.py
└── frontend\
    ├── index.html
    ├── img\
    │   └── NXP_logo.png      ← copy your logo here
    ├── css\
    │   └── style.css
    └── js\
        ├── api.js
        └── app.js
```

## Ports (kept different from the dummy-unit app so both can run side-by-side)

| Service          | Dummy Unit app | Jig & Tools app |
|-------------------|----------------|------------------|
| API (direct)       | 8100           | 8101             |
| Frontend (nginx)   | 8088           | 8089             |
