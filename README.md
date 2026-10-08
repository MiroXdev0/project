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
