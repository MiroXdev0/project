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
2. Im Vercel-Projekt unter **Storage** eine Neon-PostgreSQL-Datenbank und einen
   Vercel-Blob-Speicher verbinden. Beide Integrationen für Production, Preview
   und Development aktivieren.
3. Prüfen, dass folgende Umgebungsvariablen für die Vercel-Umgebungen gesetzt
   sind:

   | Variable | Zweck |
   | --- | --- |
   | `POSTGRES_URL` | Verbindungszeichenfolge für Neon PostgreSQL. Alternativ wird `DATABASE_URL` akzeptiert. |
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
npx vercel login
npx vercel link
npx vercel env pull .env.local
npm run dev
```

`vercel dev` führt lokal sowohl die Vite-Seite als auch die API-Funktion aus.
Alternativ können die Werte aus [`.env.example`](./.env.example) in `.env.local`
eingetragen werden. Neon und Blob müssen dafür erreichbar und konfiguriert sein.
Eine reine Vite-Vorschau (`vite preview`) stellt die API nicht bereit.

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
  werden. Zuerst `.env.local` mit `POSTGRES_URL` und `BLOB_READ_WRITE_TOKEN`
  befüllen, dann ausführen:

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
- Die Anwendung hat weiterhin keine Anmeldung oder Benutzerrechte. Projekte
  und öffentliche Blob-Dateien sind für jeden erreichbar, der die Website
  aufrufen kann. Vor einem Einsatz mit vertraulichen Schülerdaten muss ein
  passendes Authentifizierungs- und Berechtigungssystem ergänzt werden.

## Tests und Build

```sh
npm test
npm run build
```
