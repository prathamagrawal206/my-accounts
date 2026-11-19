# My Accounts: personal account management system

A private money tracker that runs as a plain static website. No build step, no server to maintain.

- **Hosting:** GitHub Pages (free)
- **Login + database:** your own Firebase project on the free Spark plan (no card needed, cannot generate a bill)
- **Libraries:** Chart.js and the Firebase SDK are bundled in `vendor/`, so the app does not depend on any CDN

## What it does

- Accounts: add, edit, delete. Deleting an account also deletes every transaction linked to it (you are shown the count first).
- Income, expenses and transfers between accounts: add, edit, delete, always against an account you pick.
- Balances are calculated from the opening balance plus the transactions, so deleting or editing a transaction updates the account immediately. The delete dialog shows the before and after balance.
- Dashboard: total balance, income, expenses, savings rate, pie charts by category for income and expenses, bar chart of income vs expenses for the last 12 months.
- Category suggestions: the add form shows your most used categories first and preselects the most common one. The dashboard shows your most common income and expense category.
- Search and filters (account, type, category, date range), monthly budgets per category, CSV export, full JSON backup and restore, multiple currencies, dark mode, works on a phone.
- Security: email + password login, database rules locked to your user ID, automatic sign-out after inactivity, offline copy wiped on sign-out, strict Content-Security-Policy, hidden from search engines.

## Try it on your computer first (2 minutes)

While `js/firebase-config.js` is empty the app runs in **local mode**: no login, data kept only in that browser. Good for a look around, not for real use.

The app must be opened through a small web server (double-clicking `index.html` will not work):

```
cd K:\personal-projects\account-management-system
python -m http.server 8000
```

Then open http://localhost:8000. (No Python? Use the "Live Server" extension in VS Code.)

## Deploy for free

### Step 1: Create the Firebase project (login + database)

1. Go to https://console.firebase.google.com and sign in with your Google account. **Create a project** (any name). Turn Google Analytics off, you do not need it.
2. **Build → Authentication → Get started → Email/Password → Enable → Save.**
3. **Authentication → Users → Add user.** Enter your email and a long, unique password. This is the only login the app will accept; the app itself has no sign-up page.
4. Copy the **User UID** shown next to your new user.
5. **Build → Firestore Database → Create database.** Pick a location near you (for India, `asia-south1 (Mumbai)`), start in **production mode**.
6. **Firestore → Rules.** Replace everything with the contents of `firestore.rules`, put your UID in place of `PASTE_YOUR_UID_HERE`, and press **Publish**.
7. **Project settings (gear icon) → Your apps → Web (`</>`) → Register app** (skip "Firebase Hosting"). Copy the `apiKey`, `authDomain`, `projectId` and `appId` values into `js/firebase-config.js`.

These config values are identifiers, not passwords. It is normal and safe for them to be public; your login and the rules in step 6 are what protect the data.

### Step 2: Put the code on GitHub

1. Create a new **public** repository at https://github.com/new (for example `my-accounts`). GitHub Pages is free only for public repositories. The repository holds the app's code, never your financial data.
2. Push this folder:

```
cd K:\personal-projects\account-management-system
git init
git add .
git commit -m "Account management system"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/my-accounts.git
git push -u origin main
```

(No git installed? On the new repository page choose "uploading an existing file" and drag in everything from this folder, including the `css`, `js` and `vendor` folders.)

### Step 3: Turn on GitHub Pages

1. In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`, folder `/ (root)` → Save.**
2. After a minute your app is live at `https://YOUR-USERNAME.github.io/my-accounts/`.
3. Back in Firebase: **Authentication → Settings → Authorized domains → Add domain →** `YOUR-USERNAME.github.io`.

Open the URL, sign in with the email and password from step 1.3, and add your first account. On your phone, open the same URL and use "Add to Home screen".

To update the app later, change the files and `git push` again.

### Recommended hardening (10 minutes, all free)

- Turn on 2-step verification for your Google account and your GitHub account. They are the keys to everything.
- Google Cloud console → APIs & Services → Credentials → your "Browser key" → **Website restrictions** → add `https://YOUR-USERNAME.github.io/*` (and `http://localhost:8000/*` if you test locally). This stops other sites from using your API key.
- Download a JSON backup from Settings now and then.
- On a shared computer leave "Keep me signed in" unticked and sign out when finished.

## If something goes wrong

| Symptom | Fix |
|---|---|
| Red banner "This login is not allowed to read the database" | The UID in the published Firestore rules does not match your user. Recheck step 1.6. |
| "Wrong email or password" | Use the user you created in Firebase Authentication, or press "Forgot password?". |
| Blank page when opening `index.html` directly | Open it through a web server (see "Try it on your computer first"). |
| GitHub Pages shows 404 | Wait a couple of minutes after enabling Pages; check that `index.html` is in the root of the repository. |

## Why these services

- **GitHub Pages** has been free for public repositories since 2008 and hosts millions of sites.
- **Firebase** is Google's app platform. The free Spark plan includes 50,000 database reads and 20,000 writes per day and 1 GB of storage, far more than one person's finances need, and it does not pause inactive projects.
- If either ever changed, the app is just static files plus a JSON backup: host the files anywhere (Cloudflare Pages, Netlify, Firebase Hosting) and restore the backup.

If you would rather keep the repository private, host the same files on Cloudflare Pages or Firebase Hosting instead; both are free and work with private repositories.

## Project layout

```
index.html            page shell + security policy
css/style.css         styles (light and dark)
js/app.js             screens, forms, charts
js/store.js           data layer (Firebase or local mode)
js/firebase-config.js your Firebase config (fill this in)
firestore.rules       database rules (paste into Firebase console)
vendor/               Chart.js 4.6.1 and Firebase SDK 13.3.0
```
