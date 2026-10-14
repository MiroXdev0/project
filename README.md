# Schulorganizer

Schulorganizer wird vollständig über Vercel bereitgestellt: Vercel hostet die
Vite-Web-App und die API-Funktionen, Neon speichert gemeinsame Projekte und
Dateimetadaten in PostgreSQL und Vercel Blob speichert die Originaldateien.

## Voraussetzungen

- Node.js 22 oder neuer (für `scripts/migrate-sqlite.js` wird Node.js 24 benötigt)
- Ein Vercel-Projekt mit aktivierten **Neon**- und **Blob**-Speichern

## Vercel einrichten und bereitstellen

1. Das Repository als Vercel-Projekt importieren. Framework Preset **Vite**,
   Build-Befehl `npm run build` und Ausgabeordner `dist` verwenden. Zusätzliche
   Rewrites sind nicht nötig: Vercel stellt `api/[...path].js` als API-Funktion
   und `dist` als Frontend unter derselben Domain bereit.
2. Im Vercel-Projekt einen Vercel-Blob-Speicher verbinden. Die Neon-Datenbank
   entweder als Neon-Integration verbinden oder ihre gepoolte
   `DATABASE_URL` aus Neon für Production, Preview und Development als
   Umgebungsvariable hinterlegen.
3. Prüfen, dass folgende Umgebungsvariablen für die Vercel-Umgebungen gesetzt
   sind:

   | Variable | Zweck |
   | --- | --- |
   | `POSTGRES_URL` oder `DATABASE_URL` | Verbindungszeichenfolge für Neon PostgreSQL. `DATABASE_URL` ist die gepoolte URL, die `neon env pull` bereitstellt. |
   | `BLOB_READ_WRITE_TOKEN` | Schreib-/Lesetoken des Vercel-Blob-Speichers. |

   Vercel-Storage-Integrationen legen diese Variablen normalerweise automatisch
   an. Eine Vorlage liegt in [`.env.example`](./.env.example).
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
`neon env pull` schreibt die Neon-Verbindungsdaten in `.env.local`. Ergänze dort
`BLOB_READ_WRITE_TOKEN` aus dem Vercel-Projekt. Alternativ kann
`vercel env pull .env.local` verwendet werden, wenn die Vercel-Umgebung sowohl
die Neon-URL als auch den Blob-Token enthält. Die Vorlage liegt in
[`.env.example`](./.env.example). Neon und Blob müssen erreichbar und
konfiguriert sein. Eine reine Vite-Vorschau (`vite preview`) stellt die API
nicht bereit.

## Daten und Migration

- Projekte/Präsentationen, Datei-Metadaten und Verknüpfungen werden gemeinsam
  in Neon gespeichert und nach Neuladen bzw. auf anderen Geräten über
  `/api/state` geladen.
- Datei-Inhalte werden direkt vom Browser nach Vercel Blob hochgeladen. Die
  Datenbank speichert die Blob-Adresse und Metadaten; keine Datei wird dauerhaft
  auf dem Vercel-Dateisystem oder in `localStorage` abgelegt.
- Aufgaben, Notizen und Fächer verwenden weiterhin den vorhandenen
  Browser-Speicher. Sie funktionieren lokal auf dem jeweiligen Gerät, werden
  aber nicht zwischen Geräten synchronisiert.
- Die App versucht beim Öffnen bisherige browserlokale Projekte und Dateien
  samt Originalen aus `localStorage`/IndexedDB in die gemeinsame Datenbank und
  Blob zu übernehmen. Jeder Browser, der nur dort gespeicherte Dateien enthält,
  muss die aktualisierte App einmal öffnen, damit seine Inhalte übertragen
  werden können.
- Eine vorhandene SQLite-Serverdatenbank kann einmalig mit Node.js 24 migriert
  werden. Zuerst `.env.local` mit `POSTGRES_URL` oder `DATABASE_URL` sowie
  `BLOB_READ_WRITE_TOKEN` befüllen, dann ausführen:

  ```sh
  npm run migrate:sqlite -- "C:\Pfad\zu\schulorganizer.sqlite"
  ```

  Das Skript überträgt Projekte, Verknüpfungen, Metadaten und gespeicherte
  Originaldateien nach PostgreSQL/Blob. Es verändert die SQLite-Quelldatei
  nicht und kann erneut ausgeführt werden, ohne bereits migrierte Blob-Dateien
  erneut hochzuladen. Vor der Migration sollte eine Sicherungskopie erstellt
  werden.

## API und Grenzen

- `GET /api/health` prüft Datenbankverbindung und Schema.
- `GET /api/state` liefert gemeinsame Projekte und Dateien.
- API-Endpunkte für Projekte, Dateien, Dateilinks und Browsermigrationen werden
  als Vercel-Funktion unter `/api` bereitgestellt.
- Gemeinsame Änderungen werden alle fünf Sekunden abgefragt; servergesendete
  Dauerverbindungen werden nicht benötigt.
- Uploads sind auf 100 MB je Datei begrenzt. Der Browser lädt Dateien direkt
  nach Blob, damit der Request nicht durch das Größenlimit einer Vercel Function
  muss.
- Die Blob-Dateien werden privat gespeichert und sind nicht direkt über ihre
  Blob-URL öffentlich abrufbar. Die Anwendung hat jedoch weiterhin keine
  Anmeldung oder Benutzerrechte; die API zum Anzeigen/Herunterladen der Dateien
  ist damit für jeden erreichbar, der die Website aufrufen kann. Vor einem
  Einsatz mit vertraulichen Schülerdaten muss ein passendes Authentifizierungs-
  und Berechtigungssystem ergänzt werden.

## Tests und Build

```sh
npm test
npm run build
```
