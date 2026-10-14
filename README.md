# Schulorganizer

Schulorganizer wird vollständig über Vercel bereitgestellt: Vercel hostet die
Vite-Web-App und API-Funktionen, Neon speichert gemeinsame Projekte und
Dateimetadaten in PostgreSQL sowie Datei-Inhalte in privatem Object Storage.

## Voraussetzungen

- Node.js 22 oder neuer (für `scripts/migrate-sqlite.js` wird Node.js 24 benötigt)
- Ein Vercel-Projekt und ein Neon-Projekt in einer Region mit Object-Storage-Unterstützung

## Vercel einrichten und bereitstellen

1. Das Repository als Vercel-Projekt importieren. Framework Preset **Vite**,
   Build-Befehl `npm run build` und Ausgabeordner `dist` verwenden. Zusätzliche
   Rewrites sind nicht nötig: Vercel stellt `api/[...path].js` als API-Funktion
   und `dist` als Frontend unter derselben Domain bereit.
2. Die gepoolte `DATABASE_URL` sowie die vier Neon-Object-Storage-Variablen für
   Production, Preview und Development in Vercel hinterlegen. `neon env pull`
   stellt sie lokal bereit; Neon überträgt sie nicht automatisch in Vercel.
3. Folgende Umgebungsvariablen müssen in den Vercel-Umgebungen gesetzt sein:

   | Variable | Zweck |
   | --- | --- |
   | `POSTGRES_URL` oder `DATABASE_URL` | Verbindungszeichenfolge für Neon PostgreSQL. `DATABASE_URL` ist die gepoolte URL, die `neon env pull` bereitstellt. |
   | `AWS_ACCESS_KEY_ID` | Neon Object Storage-Zugangsschlüssel |
   | `AWS_SECRET_ACCESS_KEY` | Neon Object Storage-Geheimschlüssel |
   | `AWS_ENDPOINT_URL_S3` | Branch-spezifischer S3-Endpunkt |
   | `AWS_REGION` | Region des Neon-Projekts |
   | `BLOB_READ_WRITE_TOKEN` | Optional; nur zum Lesen/Löschen noch nicht migrierter Vercel-Blob-Dateien |

   Die Neon-Werte stehen nach `neon deploy` in `.env.local`; trage sie als
   geheime Vercel-Umgebungsvariablen ein. Eine Vorlage liegt in
   [`.env.example`](./.env.example).
4. Änderungen auf `main` pushen oder im Projektverzeichnis `npx vercel --prod`
   ausführen. Vercel baut die Website und veröffentlicht die API-Funktion im
   selben Deployment.
5. `https://<deine-domain>/api/health` muss `{"status":"ok"}` zurückgeben.

Es gibt keine Render-Abhängigkeit, keinen dauerhaft laufenden Node-Server und
keinen separaten API-Host. Im Browser werden gleich-originierte `/api/...`-
Adressen verwendet. Die Tabellen werden beim ersten API-Aufruf in PostgreSQL
angelegt.

## Lokal entwickeln

```sh
npm ci
neon login
neon env pull .env.local
npx vercel login
npx vercel link
npm run dev
```

`vercel dev` führt lokal sowohl die Vite-Seite als auch die API-Funktion aus.
`neon env pull` schreibt die Neon-Verbindungs- und Object-Storage-Daten in
`.env.local`. `BLOB_READ_WRITE_TOKEN` ist nur erforderlich, solange vorhandene
Vercel-Blob-Dateien noch nicht migriert wurden. Die Vorlage liegt in
[`.env.example`](./.env.example). Neon muss erreichbar und konfiguriert sein.
Eine reine Vite-Vorschau (`vite preview`) stellt die API nicht bereit.

## Daten und Migration

- Projekte/Präsentationen, Datei-Metadaten und Verknüpfungen werden gemeinsam
  in Neon gespeichert und nach Neuladen bzw. auf anderen Geräten über
  `/api/state` geladen.
- Neue Datei-Inhalte und Browsermigrationen werden mit kurzlebigen, serverseitig
  signierten URLs direkt vom Browser in den privaten Neon Object Storage
  geladen. PostgreSQL speichert den Objektschlüssel und die Metadaten; Neon
  Object Storage prüft und liefert Datei-Inhalte über die API aus.
- Bereits vorhandene Vercel-Blob-Dateien bleiben lesbar. Mit
  `npm run migrate:vercel-files` lassen sie sich idempotent nach Neon kopieren;
  das Skript prüft jede Kopie und löscht das Vercel-Original nicht.
- Nach dem Bereitstellen des Buckets muss einmalig die Browser-CORS-Regel
  gesetzt werden: `npm run storage:cors`.
- Aufgaben, Notizen und Fächer verwenden weiterhin den vorhandenen
  Browser-Speicher. Sie funktionieren lokal auf dem jeweiligen Gerät, werden
  aber nicht zwischen Geräten synchronisiert.
- Die App versucht beim Öffnen bisherige browserlokale Projekte und Dateien
  samt Originalen aus `localStorage`/IndexedDB in die gemeinsame Datenbank und
  den Neon Object Storage zu übernehmen. Jeder Browser, der nur dort
  gespeicherte Dateien enthält, muss die aktualisierte App einmal öffnen,
  damit seine Inhalte übertragen werden können.
- Eine vorhandene SQLite-Serverdatenbank kann einmalig mit Node.js 24 migriert
  werden. Zuerst `.env.local` mit `POSTGRES_URL` oder `DATABASE_URL` und den
  vier `AWS_*`-Object-Storage-Variablen befüllen, dann ausführen:

  ```sh
  npm run migrate:sqlite -- "C:\Pfad\zu\schulorganizer.sqlite"
  ```

  Das Skript überträgt Projekte, Verknüpfungen, Metadaten und gespeicherte
  Originaldateien nach PostgreSQL/Neon Object Storage. Es verändert die
  SQLite-Quelldatei nicht und kann erneut ausgeführt werden, ohne bereits
  migrierte Dateien erneut hochzuladen. Vor der Migration sollte eine
  Sicherungskopie erstellt werden.

## API und Grenzen

- `GET /api/health` prüft Datenbankverbindung und Schema.
- `GET /api/state` liefert gemeinsame Projekte und Dateien.
- API-Endpunkte für Projekte, Dateien, Dateilinks und Browsermigrationen werden
  als Vercel-Funktion unter `/api` bereitgestellt.
- Gemeinsame Änderungen werden alle fünf Sekunden abgefragt; servergesendete
  Dauerverbindungen werden nicht benötigt.
- Uploads sind auf 100 MB je Datei begrenzt. Der Browser lädt direkt in den
  privaten Neon-Bucket, damit Datei-Inhalte nicht durch das Größenlimit einer
  Vercel Function müssen.
- Die Object-Storage-Dateien sind nicht öffentlich abrufbar. Die Anwendung hat
  jedoch weiterhin keine Anmeldung oder Benutzerrechte; die API zum
  Anzeigen/Herunterladen der Dateien ist damit für jeden erreichbar, der die
  Website aufrufen kann. Vor einem Einsatz mit vertraulichen Schülerdaten muss
  ein passendes Authentifizierungs- und Berechtigungssystem ergänzt werden.

## Tests und Build

```sh
npm test
npm run build
npm run test:storage
```

`npm run test:storage` lädt eine eindeutige temporäre Datei über denselben
signierten Upload- und API-Ablauf hoch, liest und vergleicht den Inhalt und
löscht anschließend sowohl das Objekt als auch den Datenbankeintrag. Es benötigt
die Neon-Variablen aus `.env.local`.
