# Schulorganizer

## Lokal starten

Benötigt wird Node.js 22 oder neuer.

```sh
npm ci
npm run dev
```

Die Anwendung läuft unter `http://localhost:5173`. Im Entwicklungsmodus stellt
der Node-Server die API auf Port 3001 bereit; Vite leitet `/api` dorthin weiter.

## Bereitstellung mit gemeinsamen Projekten und Dateien

Die Produktionsversion muss als Node-Webdienst gestartet werden (`npm start`).
Der Server liefert dabei sowohl die Web-App als auch die API unter derselben
Adresse aus. Eine rein statische Bereitstellung, zum Beispiel auf GitHub Pages,
stellt die Datenbank-API nicht bereit und synchronisiert daher keine Projekte
oder Dateien.

### Vercel-Frontend mit gemeinsamem Datei-Server

Ein Vercel-Deployment, das nur `vite build` ausführt, hostet die statische Website,
aber nicht den Express-/SQLite-Server. Damit Uploads eines Geräts auf anderen
Geräten erscheinen, muss ein laufender Node-Server mit dauerhaftem Datenträger
bereitstehen und das Vercel-Frontend auf dessen API zeigen:

1. `render.yaml` als Blueprint in Render bereitstellen und die angezeigte
   `APP_ORIGIN`-Variable auf die vollständige Vercel-Website-Adresse setzen,
   zum Beispiel `https://schulorganizer.vercel.app`. Render stellt hierfür eine
   dauerhafte SQLite-Festplatte bereit.
2. Den tatsächlichen öffentlichen Service-Link aus dem Render-Dashboard öffnen
   und prüfen, dass `<Service-Link>/api/health` `{"status":"ok"}` zurückgibt.
3. In Vercel unter **Project → Settings → Environment Variables** die Variable
   `VITE_API_URL` auf `<Service-Link>/api` setzen, zum Beispiel
   `https://dein-service.onrender.com/api`, für alle benötigten Umgebungen.
4. Eine neue Vercel-Bereitstellung auslösen. `VITE_API_URL` wird beim Build in
   die Website übernommen.
5. Auf beiden Geräten dieselbe Vercel-Adresse öffnen. Zum Prüfen des Backends
   `<Service-Link>/api/state` direkt aufrufen; dort muss JSON erscheinen. Die
   Adresse `/api/state` auf Vercel selbst wird bei direkter API-Konfiguration
   nicht zum Backend weitergeleitet.

Der Name `schulorganizer` in `render.yaml` ist nur der gewünschte Render-Service-
Name; verwende immer den tatsächlich im Render-Dashboard angezeigten Link.
Ohne diese beiden Einstellungen kann die Website Dateien lokal auswählen, aber
der gemeinsame Server kann sie nicht speichern oder zwischen Geräten verteilen.

Projekte, Datei-Metadaten und Originaldateien werden in einer SQLite-Datenbank
gespeichert. `DATABASE_PATH` legt den Datenbankpfad fest; standardmäßig ist das
`data/schulorganizer.sqlite`. In der Hosting-Umgebung muss dieser Pfad auf einem
dauerhaft gespeicherten Laufwerk liegen, damit Daten Deployments und Neustarts
überstehen. `render.yaml` enthält eine entsprechende Konfiguration für einen
Node-Webdienst mit persistenter Festplatte. SQLite wird hier für einen einzelnen
Serverprozess verwendet; mehrere unabhängige Serverinstanzen dürfen nicht
jeweils ihre eigene lokale Datenbank verwenden.

Alle Nutzer derselben Serverinstanz sehen denselben Projekt- und Dateibestand.
Die Anwendung enthält derzeit keine Anmeldung oder Berechtigungen. Wer den
Dienst öffentlich erreichbar macht, muss daher berücksichtigen, dass Nutzer
gemeinsame Inhalte auch ändern oder löschen können.

Uploads sind serverseitig auf 100 MB pro Datei begrenzt. Der Server stellt
`GET /api/health` für einfache Statusprüfungen bereit.

Beim ersten Öffnen der aktualisierten App versucht jeder Browser außerdem,
bisher lokal gespeicherte Dateien samt Originalinhalten und Präsentationsprojekten
auf den Server zu übertragen. Die App gleicht frühere Einträge auch bei späteren
Starts ab, setzt unvollständige Übertragungen fort und ergänzt fehlende Originale
oder Projektanhänge. Die lokalen Originaldaten bleiben dabei erhalten. Weil frühere
Uploads ausschließlich im jeweiligen Browser gespeichert waren, muss jedes Gerät
bzw. jeder Browser mit solchen Altdateien die aktualisierte App mindestens einmal
öffnen, während der Server erreichbar ist. Die Übernahme ist wiederholbar und
erzeugt bei einem erneuten Versuch keine doppelten Einträge.

## Tests und Build

```sh
npm test
npm run build
```
