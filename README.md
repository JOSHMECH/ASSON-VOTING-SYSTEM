# ASSON Voting System — Complete Setup Guide

> **Stack:** Vanilla HTML5 / CSS3 / JS · Supabase (PostgreSQL + Auth + PostgREST) · Paystack · Chart.js

---

## File Structure

```
asson-voting/
├── schema.sql      → PostgreSQL table definitions (run in Supabase SQL Editor)
├── style.css       → Global theme, layout, components
├── index.html      → Student login + voting portal
├── app.js          → Auth, cart, Paystack integration
├── admin.html      → Admin dashboard layout
└── admin.js        → Analytics, charts, CRUD management
```

---

## Step 1 — Supabase Project Setup

### 1.1 Create a Supabase Project
1. Go to [https://supabase.com](https://supabase.com) and sign in.
2. Click **New Project** → enter a name (e.g. `asson-voting`) → choose your region → set a strong database password.
3. Wait ~2 minutes for the project to provision.

### 1.2 Run the Schema
1. In your Supabase dashboard, navigate to **SQL Editor** → **New query**.
2. Open `schema.sql`, copy the entire contents, paste into the editor.
3. Click **Run**. You should see success messages for all CREATE TABLE, INDEX, POLICY, and VIEW statements.
4. Navigate to **Table Editor** to confirm the four tables exist: `elections`, `positions`, `candidates`, `votes`.

### 1.3 Collect Your Credentials
From your Supabase dashboard → **Settings** → **API**:
- **Project URL** — looks like `https://xyzxyz.supabase.co`
- **Anon/Public Key** — the `anon` key under "Project API keys"
- **Service Role Key** *(for admin only — keep secret)* — the `service_role` key

> ⚠️ **Security Note:** For the admin dashboard in production, use the **service_role** key (or a custom admin JWT) in `admin.html`'s config block so it can bypass RLS. Never expose the service_role key in a public-facing page.

### 1.4 Disable Email Confirmation (Required for Matric Login)
1. Go to **Authentication** → **Providers** → **Email**.
2. Toggle **Confirm email** to **OFF**.
3. Click **Save**.

This allows students to register and immediately log in with their Matric/Surname without email verification.

---

## Step 2 — Paystack Setup

1. Create a free account at [https://paystack.com](https://paystack.com).
2. From your Paystack dashboard → **Settings** → **API Keys & Webhooks**.
3. Copy your **Public Key** — it looks like `pk_test_xxxxxxxxxxxxxxxx` (test) or `pk_live_xxxxxxxxxxxxxxxx` (production).
4. The **inline popup** is loaded via the CDN script already in `index.html`:
   ```html
   <script src="https://js.paystack.co/v1/inline.js"></script>
   ```

---

## Step 3 — Configure the Application

### index.html — Student Portal Config Block
Open `index.html` and find the `<script>` block near the bottom:

```javascript
window.ASSON_CONFIG = {
    supabaseUrl:    'https://YOUR_PROJECT_REF.supabase.co',  // ← paste Project URL
    supabaseKey:    'YOUR_SUPABASE_ANON_KEY',                // ← paste Anon Key
    paystackPubKey: 'pk_test_YOUR_PAYSTACK_PUBLIC_KEY',      // ← paste Paystack Key
    dummyDomain:    '@asson.app',                            // ← leave as-is
};
```

### admin.html — Admin Dashboard Config Block
Open `admin.html` and find its config block:

```javascript
window.ASSON_CONFIG = {
    supabaseUrl:    'https://YOUR_PROJECT_REF.supabase.co',  // ← same Project URL
    supabaseKey:    'YOUR_SUPABASE_SERVICE_ROLE_KEY',        // ← use service_role key
    adminPassword:  'ASSON_ADMIN_2024',                      // ← change this passphrase
};
```

> **Tip:** To add a proper admin login gate, add a password prompt before any admin content renders. The `adminPassword` field supports a simple `prompt()` check — see the Security section below for an upgrade path.

---

## Step 4 — Supabase Row Level Security (RLS) Reference

The schema already creates all necessary RLS policies. Here's a plain-English summary:

| Table | Who can READ | Who can INSERT | Who can UPDATE/DELETE |
|---|---|---|---|
| `elections` | Anyone (active only) | Blocked | Admin (service role) |
| `positions` | Anyone | Blocked | Admin (service role) |
| `candidates` | Anyone | Blocked | Admin (service role) |
| `votes` | Authenticated (own votes) | Authenticated (own votes) | Admin (service role) |

For admin write operations (creating elections, candidates etc.), `admin.js` uses the **service_role key** which bypasses RLS entirely. This is safe as long as `admin.html` is not publicly indexed.

---

## Step 5 — How the Authentication Works

### Matric Number + Surname → Supabase Email/Password Auth

The `login()` function in `app.js` transforms the student's credentials:

```
Matric:   CSC/2020/001
Surname:  Adewale

Email:    csc-2020-001@asson.app         ← .toLowerCase() + replace(/) + @asson.app
Password: ADEWALE                         ← .trim().toUpperCase()
```

**Flow:**
1. Student submits the form.
2. `app.js` attempts `signInWithPassword` on Supabase Auth.
3. If the user doesn't exist yet, it **auto-registers** them with `signUp` using the same email/password.
4. On success, the session token is stored in `sessionStorage` (cleared when the tab closes).
5. The voting page renders immediately — no redirect needed.

---

## Step 6 — How the Voting Cart & Payment Works

```
Student selects candidates
        ↓
Clicks [+ Add Vote] on a candidate card
        ↓
Cart sidebar updates with quantity & total cost
(Total = sum of all quantities × election's price_per_vote)
        ↓
Student clicks [Pay & Vote] button
        ↓
Paystack inline popup opens (amount in kobo)
        ↓
Student completes payment on Paystack
        ↓
Paystack fires callback(response) with a payment reference
        ↓
app.js calls saveVotes(reference, amount)
        ↓
Vote rows are inserted into Supabase `votes` table
(one row per candidate, containing number_of_votes & payment_reference)
        ↓
Success modal confirms the vote + reference number
```

**Important:** Votes are **only written to the database after a successful Paystack callback**. The `onClose` handler (cancelled payment) does NOT write any votes.

---

## Step 7 — Admin Dashboard Features

### Overview Panel
- **4 Metric Cards:** Total Revenue, Total Votes Cast, Registered Students, Active Elections
- **Line Chart:** Revenue over time (grouped by calendar day) — rendered in green theme
- **Bar Chart:** Top 8 candidates by vote count — horizontal bar, green palette
- **Recent Transactions Table:** Last 20 payment records with references

### Leaderboard Panel
- Full ranked table with gold/silver/bronze rank badges
- Visual vote-bar showing proportional vote share
- Filter by election using the dropdown
- Auto-refreshes every 30 seconds

### Transactions Panel
- Complete paginated transaction log
- Live search by payment reference or matric number

### Management Panels

#### Elections
- **Create** a new election with title, description, price per vote, active status
- **Archive** — flips `is_active` to `FALSE` (hides from student portal, data preserved)
- **Delete** — permanently removes the election and all cascading positions/candidates/votes

#### Categories (Positions)
- Add positions tied to a specific election
- Delete positions (cascades to candidates and votes for that position)

#### Candidates
- Add candidates with name, photo URL, and bio
- Filter the list by election
- Delete individual candidates

---

## Step 8 — Deployment Options

### Option A: GitHub Pages (Recommended for Static Files)

1. Create a GitHub repository (e.g. `asson-voting`)
2. Push all 6 files to the repository root
3. Go to **Settings** → **Pages** → **Source**: `main` branch, `/ (root)`
4. Your student portal will be live at `https://yourusername.github.io/asson-voting/`
5. Keep `admin.html` in a non-obvious path or protect it with a redirect

### Option B: Netlify Drop

1. Go to [https://app.netlify.com/drop](https://app.netlify.com/drop)
2. Drag and drop the entire `asson-voting/` folder
3. Netlify generates a unique URL instantly

### Option C: Any Static Host

Just upload all 6 files to the same directory on any web host (Hostinger, cPanel, Vercel, Cloudflare Pages, etc.). No server-side runtime is needed — all backend logic runs through Supabase's hosted API.

---

## Step 9 — Adding Your First Election (Quick Start)

After deployment, open `admin.html` and:

1. **Create Election** → enter title, description, set price (e.g. ₦100/vote) → click **Create Election**
2. **Add Categories** → select the election → add positions (e.g. "Best Dressed Male", "Most Intelligent") → click **Add Position**
3. **Add Candidates** → select election → select position → enter candidate name + photo URL → click **Add Candidate**
4. Share `index.html` URL with students

---

## Step 10 — Security Hardening for Production

### Admin Dashboard Protection
Replace the plain `adminPassword` config with a proper check:

```javascript
// At the top of admin.js, before any data loads:
(function adminGate() {
  const entered = sessionStorage.getItem('asson_admin_auth');
  if (entered !== 'true') {
    const pw = prompt('Enter Admin Password:');
    if (pw !== CFG.adminPassword) {
      document.body.innerHTML = '<h2 style="text-align:center;margin-top:20vh;color:#dc2626;">Access Denied</h2>';
      throw new Error('Unauthorized');
    }
    sessionStorage.setItem('asson_admin_auth', 'true');
  }
})();
```

### Paystack Webhook Verification (Optional but Recommended)
For a production setup, verify the Paystack payment server-side using a Supabase Edge Function before writing votes. This prevents fake payment references.

### Move Sensitive Keys to Environment Variables
If you use a build tool or Supabase Edge Functions, store keys in `.env` files rather than inline script tags.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Students can't log in | Check that **email confirmation** is OFF in Supabase Auth settings |
| Votes not saving | Confirm RLS policy allows authenticated INSERT on `votes`; check browser console for 401/403 errors |
| Paystack popup not opening | Verify your Paystack public key is correct and you're on HTTPS (required for Paystack) |
| Charts not rendering | Ensure Chart.js CDN loads; check browser console for `Chart is not defined` |
| Admin can't create elections | Confirm `admin.js` uses the **service_role** key, not the anon key |
| `vote_leaderboard` view not found | Re-run `schema.sql` in full; the view is defined near the bottom |
| Foreign key errors on delete | Ensure `ON DELETE CASCADE` is in place — it's included in the schema |

---

## Database Quick Reference

```sql
-- Check total revenue
SELECT SUM(amount_paid) FROM votes;

-- Top candidates across all elections
SELECT * FROM vote_leaderboard LIMIT 10;

-- Votes per election
SELECT e.title, SUM(v.number_of_votes) as total_votes, SUM(v.amount_paid) as revenue
FROM votes v
JOIN candidates c ON c.id = v.candidate_id
JOIN positions p ON p.id = c.position_id
JOIN elections e ON e.id = p.election_id
GROUP BY e.title
ORDER BY revenue DESC;

-- Archive all elections (end of voting)
UPDATE elections SET is_active = FALSE;

-- Find duplicate payment references (sanity check)
SELECT payment_reference, COUNT(*) FROM votes
GROUP BY payment_reference HAVING COUNT(*) > 1;
```

---

*Built for ASSON — Departmental Awards & Monetized Voting System*
