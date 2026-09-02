# Haushaltsplaner – gemeinsam nutzbare Webapp

Diese App speichert ihren Zustand nicht mehr nur lokal im Browser, sondern in
einer gemeinsamen Supabase-Datenbank. Änderungen von dir und deinem Partner
werden per Realtime sofort auf beiden Geräten angezeigt.

## 1. Supabase einrichten

Du hast das vermutlich schon gemacht. Falls die Tabelle `household_state`
noch nicht existiert (oder du sicher gehen willst), führe `supabase-setup.sql`
im SQL Editor deines Supabase-Projekts aus.

Danach unter **Project Settings → API** kopieren:
- Project URL
- anon public key

## 2. Lokal einrichten (optional, zum Testen)

```bash
npm install
cp .env.example .env
# .env mit deinen echten Werten befüllen
npm run dev
```

## 3. Auf GitHub hochladen

```bash
git init
git add .
git commit -m "Initial commit"
# Repo auf github.com anlegen, dann:
git remote add origin <DEINE-REPO-URL>
git push -u origin main
```

Wichtig: Die `.env`-Datei wird durch `.gitignore` automatisch NICHT
mitgeladen – deine Keys landen also nicht in GitHub.

## 4. Auf Vercel deployen

1. Auf vercel.com mit GitHub einloggen, "Add New Project", dein Repo wählen.
2. Vercel erkennt Vite automatisch (Build Command: `vite build`, Output: `dist`).
3. Unter "Environment Variables" hinzufügen:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy klicken. Du bekommst eine URL wie `haushalt-app.vercel.app`.

Diese URL an deinen Partner schicken – ihr seht und bearbeitet beide
denselben Stand, in Echtzeit.

## Hinweis zur Sicherheit

Die Datenbank-Policy in `supabase-setup.sql` erlaubt aktuell jedem mit dem
anon key vollen Zugriff auf die Tabelle (kein Login nötig). Für eine private
App zwischen zwei Personen ist das meist okay, solange die URL nicht
öffentlich geteilt wird – aber es ist kein echter Zugriffsschutz. Falls ihr
das absichern wollt, könnte man Supabase Auth (z.B. Magic Link Login)
ergänzen; sag Bescheid, wenn du das möchtest.
