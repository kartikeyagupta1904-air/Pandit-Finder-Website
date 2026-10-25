# Pandit Finder

**Find Your Pandit. Celebrate Your Traditions.**

A full-stack web application that connects families with verified Hindu pandits for pujas, havans, weddings, griha pravesh, Satyanarayan katha, Rudrabhishek, mundan and other ceremonies.

- **Frontend:** HTML5, CSS3, JavaScript, Bootstrap 5, Bootstrap Icons, Leaflet + OpenStreetMap, Chart.js (all served locally from `node_modules`)
- **Backend:** Node.js + Express (REST API)
- **Database:** SQLite (via `better-sqlite3`), persistent file in `data/`
- **Auth:** server-side sessions stored in SQLite, bcrypt password hashing, CSRF tokens, rate limiting

---

## 1. Quick start

Requirements: **Node.js 18.18+** (tested on Node 24).

```bash
npm install
```

```bash
cp .env.example .env
```

Edit `.env` and set `SESSION_SECRET` to a long random string. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Create an administrator (you will be prompted for an email and a password of 12+ characters):

```bash
npm run create-admin
```

Optional: load **sample data** for development (8 sample pandits, 3 sample customers, availability, past bookings and reviews). Every sample pandit is labelled **"Sample profile"** in the UI. The generated logins are written to `data/sample-credentials.txt` (git-ignored).

```bash
npm run seed
```

Start the server:

```bash
npm start
```

Open http://localhost:3000.

On Windows PowerShell, use `copy .env.example .env` instead of `cp`.

### Run the tests

```bash
npm test
```

The test suite (`tests/workflows.test.js`) starts the app on a temporary database and runs 20 end-to-end API tests that cover every workflow in the brief (see section 8).

---

## 2. Project structure

```
pandit-finder/
├── server.js                  # Entry point: starts HTTP server + maintenance job
├── src/
│   ├── app.js                 # Express app (security headers, sessions, static, routes, errors)
│   ├── config/                # Environment configuration
│   ├── database/              # schema.sql, db connection/migration, seed, create-admin
│   ├── middleware/            # auth/roles, CSRF, SQLite session store, secure uploads
│   ├── routes/                # auth, public (search/profiles/apply), pandit, bookings, account, admin
│   ├── services/              # bookings, availability, pandits (search), payments, notifications, audit, settings, maintenance
│   ├── validators/            # Declarative input validation
│   └── utils/                 # errors, date/time helpers
├── public/                    # Frontend pages, css/, js/, images/
├── tests/                     # Automated tests (node:test + supertest)
├── data/                      # SQLite database (created at runtime, git-ignored)
├── uploads/
│   ├── photos/                # Public profile photos (random file names)
│   └── private/               # Verification documents — NEVER served statically
├── .env.example
└── package.json
```

---

## 3. Using the application

| Role | How to get an account | Main page |
|------|----------------------|-----------|
| Customer | `/register.html` | `/customer-dashboard.html` |
| Pandit | `/become-pandit.html` (application + documents) | `/pandit-dashboard.html` |
| Administrator | `npm run create-admin` only (never through a web form) | `/admin.html` |

**Typical flow**

1. A pandit applies → status **Pending** → administrators are notified.
2. An administrator reviews the profile and private documents → **Approve** (marks identity/experience verified) or **Reject** with a reason.
3. Approved pandits appear in search. They manage services, prices, availability windows and blocked dates.
4. A customer searches, opens a profile, picks a service, date and an available time slot, enters location and notes, reviews the estimated cost, and submits a **booking request** (status *Pending*).
5. The pandit **accepts** or **declines**. Accepting automatically declines other pending requests that overlap that time.
6. The customer **confirms** (pay later, or online payment when configured) → *Confirmed*. Contact details are now shared between the two parties, and both can message each other on the booking page.
7. After the ceremony time, the pandit marks it **Completed**, and the customer can leave **one review** for that booking.
8. Customers can **cancel** (with explicit confirmation) or **reschedule** up to the configured cancellation window. A reschedule returns the booking to *Pending*.

Booking statuses: `pending → accepted → confirmed → completed`, plus `rejected` and `cancelled`.

---

## 4. Database design

The schema is in `src/database/schema.sql`. It is applied automatically on start (`CREATE … IF NOT EXISTS`), or you can run it with `npm run migrate`.

| Table | Purpose / key relationships |
|-------|-----------------------------|
| `users` | All accounts; `role` ∈ customer/pandit/admin; unique email; `status` active/suspended |
| `customer_profiles` | 1:1 with `users` (city, language) |
| `cities` | Reference list with approximate coordinates (for maps and city filters) |
| `pandit_profiles` | 1:1 with `users`; FK `city_id`; verification status, verified flags, `is_sample` |
| `pandit_languages`, `pandit_specializations`, `pandit_service_areas` | Many-to-many / 1:N details of a pandit |
| `pandit_verification_documents` | Private documents (stored filename only), purged after retention |
| `puja_categories` | Ceremony types (admin managed) |
| `pandit_services` | Services of a pandit: duration, price, samagri, travel charge, mode, requirements |
| `availability_slots` | Open time windows per pandit per date |
| `blocked_dates` | Dates a pandit is unavailable |
| `bookings` | FK customer, pandit, service, category; date + `start_min`/`end_min`; server-computed price; status |
| `booking_events` | Full history of every status change / reschedule |
| `booking_messages` | In-platform messages between customer and pandit |
| `payments` | Pay-later / Razorpay / offline records with status pending/successful/failed/refunded |
| `reviews` | One per booking (UNIQUE `booking_id`), rating 1–5, moderation status |
| `favourites` | Customer ↔ pandit saved list |
| `notifications` | In-app notifications with read flag |
| `complaints` | Customer complaints and profile reports, admin notes |
| `audit_logs` | Sensitive/admin actions with actor, entity, details, IP |
| `platform_settings` | Key/value configuration (cancellation window, lead time, retention…) |
| `sessions` | Server-side session storage |

**Preventing double bookings:** besides application checks inside `BEGIN IMMEDIATE` transactions, two SQLite triggers (`trg_bookings_no_overlap_insert/update`) abort any insert or update that would give a pandit two overlapping *accepted/confirmed* bookings. So even concurrent requests cannot create a conflict. This is covered by the tests.

**Retention:** verification documents are deleted from disk (and marked `purged_at`) after `document_retention_days` from the admin decision. Bookings and reviews are kept for history; services with bookings are archived rather than deleted; categories in use are deactivated rather than deleted.

---

## 5. REST API (summary)

All write requests need the `X-CSRF-Token` header (get it from `GET /api/auth/csrf`). Errors are JSON: `{ "error": "...", "fields": {...} }`.

| Area | Endpoints |
|------|-----------|
| Auth | `GET /api/auth/csrf`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `PUT /api/auth/profile`, `POST /api/auth/change-password` |
| Public | `GET /api/categories`, `GET /api/cities`, `GET /api/languages`, `GET /api/services`, `GET /api/stats`, `GET /api/settings/public`, `GET /api/reviews/recent` |
| Pandits | `GET /api/pandits` (filters: `city, locality, category, date, available=week, language, min_experience, min_price, max_price, min_rating, mode, q, sort, page, limit`), `GET /api/pandits/:id`, `GET /api/pandits/:id/reviews`, `GET /api/pandits/:id/availability?date=&service_id=` or `?from=&to=`, `POST /api/pandits/apply` (multipart) |
| Pandit (own) | `GET /api/pandit/me`, `PUT /api/pandit/profile` (alias `PUT /api/pandits/profile`), `POST/DELETE /api/pandit/photo`, `POST /api/pandit/documents`, `GET/POST /api/pandit/services`, `PUT/DELETE /api/pandit/services/:id`, `GET/POST /api/pandit/availability`, `DELETE /api/pandit/availability/:id`, `POST /api/pandit/blocked-dates`, `DELETE /api/pandit/blocked-dates/:id`, `GET /api/pandit/dashboard`, `GET /api/pandit/reviews` |
| Bookings | `POST /api/bookings`, `GET /api/bookings/my`, `GET /api/bookings/:id`, `PATCH /api/bookings/:id/status`, `POST /api/bookings/:id/confirm`, `POST /api/bookings/:id/cancel`, `POST /api/bookings/:id/reschedule`, `GET/POST /api/bookings/:id/messages`, `POST /api/bookings/:id/review`, `POST /api/bookings/:id/payments/razorpay-order`, `POST /api/bookings/:id/payments/offline` |
| Account | `GET /api/notifications`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`, `GET /api/favourites`, `POST/DELETE /api/favourites/:panditId`, `POST /api/complaints`, `GET /api/complaints/my` |
| Payments | `POST /api/payments/razorpay/verify`, `POST /api/payments/razorpay/webhook` |
| Admin | `GET /api/admin/dashboard`, `GET /api/admin/verifications`, `GET/PATCH /api/admin/verifications/:id`, `GET /api/admin/documents/:id`, `GET /api/admin/users`, `PATCH /api/admin/users/:id/status`, `GET/POST /api/admin/categories`, `PUT/DELETE /api/admin/categories/:id`, `GET /api/admin/complaints`, `PATCH /api/admin/complaints/:id`, `GET /api/admin/bookings`, `GET /api/admin/reviews`, `PATCH /api/admin/reviews/:id`, `GET /api/admin/audit-logs`, `GET/PUT /api/admin/settings` |

---

## 6. Security measures

- Passwords hashed with **bcrypt** (12 rounds); login timing is equalised for unknown emails.
- **Server-side sessions** in SQLite; `httpOnly`, `SameSite=Lax` cookies, `Secure` in production; the session ID is regenerated on login; other sessions are revoked on password change and on suspension.
- **CSRF** synchroniser token on every POST/PUT/PATCH/DELETE.
- **Rate limiting** on login, registration, password change and pandit applications.
- **Parameterized SQL** everywhere; declarative input validation; all dynamic HTML is escaped on the client.
- **Helmet** security headers and a strict Content-Security-Policy (no inline scripts).
- **Role checks on the server** for every protected route. The public registration form can only create customers. Admins are created only from the command line.
- Booking IDs, customer IDs, prices, statuses and payment results sent by the browser are **ignored**. The server derives them from the session and the database.
- **Uploads:** size limits, file type detected from file content (magic bytes), random file names. Documents are stored in `uploads/private`, are never served statically, and are streamed only to admins (each view is audit-logged).
- Private phone numbers, emails and documents are never in public responses. Contact details are shared only between the two parties of an accepted booking. Maps show an approximate city area only.
- **Audit log** for approvals and rejections, suspensions, category, review and settings changes, document views and admin logins.
- Error responses never expose stack traces.

For production: set `NODE_ENV=production`, a strong `SESSION_SECRET`, run behind HTTPS (set `TRUST_PROXY=1` behind a proxy), set `SHOW_SAMPLE_DATA=0`, and back up `data/` and `uploads/`.

---

## 7. Optional integrations

### Online payments (Razorpay)

Without credentials, the app uses a clearly labelled **Pay later** workflow: the payment is recorded as *pending*, and the pandit can record an offline payment, which is shown as self-reported. No payment is ever marked successful without verification.

To enable Razorpay:

1. Create keys in the Razorpay dashboard (start with **test mode**).
2. Set them in `.env`:
   ```
   RAZORPAY_KEY_ID=rzp_test_xxx
   RAZORPAY_KEY_SECRET=xxx
   RAZORPAY_WEBHOOK_SECRET=xxx
   ```
3. In Razorpay, add a webhook to `https://<your-domain>/api/payments/razorpay/webhook` for `payment.captured`, `payment.failed` and `refund.processed`.
4. Restart the server. After the pandit accepts, customers see **Pay online** when confirming.

The server creates the order, and the browser opens Razorpay Checkout. The server then verifies the HMAC signature (and the webhook signature) before marking the payment *successful* and the booking *confirmed*. Card details never touch this server. Refunds for cancelled paid bookings are flagged to the admin to process in Razorpay; the webhook then marks them *refunded*.

### Email notifications (SMTP)

In-app notifications always work. To also send emails:

```bash
npm install nodemailer
```

Then set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` in `.env`. The admin **Settings** tab shows whether email is configured. The app never claims an email was sent unless the provider accepted it. SMS can be added the same way in `src/services/notify.js`.

### Maps and geocoding

Profiles show an approximate city-area circle on an OpenStreetMap map (Leaflet), using the city coordinates in the `cities` table. No external geocoding calls are made. If you add geocoding (for example Nominatim), follow its usage policy (max 1 request/second, a proper User-Agent, caching) and never geocode or show a pandit's home address. Distance-based sorting is intentionally not offered, because only city-level locations are stored.

---

## 8. Testing and QA

`npm test` runs the following against a fresh temporary database:

1. Customer registration and login (including role-escalation attempt, duplicate email, weak password, wrong password)
2. Pandit application with secure document upload (and invalid file rejection)
3. Admin verification (role checks, private document access, approve/reject with reason)
4. Search and filters (city, locality, category, language, experience, price, rating, mode, date, sorting, pagination)
5. Public profile without private data
6. Booking request with server-computed price, ignoring client-supplied price/status/customer
7. Accepting and rejecting bookings, with notifications
8. Conflict prevention: overlapping accepts, concurrent accepts, and the database trigger
9. Cancel (explicit confirmation, policy window) and reschedule (server-side slot validation)
10. Reviews: only completed bookings, one per booking, averages from records, moderation
11. Unauthorized access: other customers and other pandits get 404/403
12. Managing services (archive vs delete) and availability/blocked dates
13. Invalid inputs (past dates, bad dates/times, off-grid times, outside availability, malformed JSON)
14. Data and logins persisting after a server restart

Latest run in this environment: **20 tests, 20 passed, 0 failed**. The UI was also checked manually in a browser: home page, search, profile with live calendar, booking request, admin and pandit dashboards, and the mobile layout.

---

## 9. Notes and limitations

- Times use the server's local time zone. Run the server in IST (Asia/Kolkata) for Indian bookings.
- Search loads matching rows and paginates in memory so that date availability can be confirmed accurately. This is fine for thousands of pandits. For a much larger catalogue, add a precomputed availability table.
- The policies page is a template. Have it reviewed before commercial use.
