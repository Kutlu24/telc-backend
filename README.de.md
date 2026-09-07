# telc-backend

Das API-Backend für eine Übungs-App zum TELC-C1-Hörverstehen. Gehört zusammen mit [telc-frontend](https://github.com/Kutlu24/telc-frontend), dem dazugehörigen Client.

🇬🇧 English version: [README.md](README.md)

## Was der Dienst macht

Ein kleiner Express- + SQLite-Dienst für Benutzerkonten und (perspektivisch) Prüfungsinhalte:

- `POST /register` — legt einen Benutzer an, Passwort wird mit bcrypt gehasht.
- `POST /login` — prüft die Zugangsdaten, stellt ein JWT mit 2 Stunden Gültigkeit aus.
- SQLite-Tabellen für `users` und `exams`.

## Technik

Node.js, Express 5, SQLite3, bcrypt, jsonwebtoken, cors.

## Ausführen

```bash
npm install
node server.js
```

Der Port lässt sich über die Umgebungsvariable `PORT` steuern (Standard: 3000).

## Konfiguration

**`JWT_SECRET`** in den Umgebungsvariablen des Deployments setzen (z. B. Render → Environment). Ist sie nicht gesetzt, erzeugt der Server beim Start ein zufälliges Secret als Notlösung — die Anmeldung funktioniert weiterhin, aber jeder Neustart macht bestehende Tokens ungültig. Für den Produktivbetrieb nicht geeignet.

## Sicherheitshinweis (behoben 09/2026)

Dieses Repository enthielt zuvor ein fest im Code hinterlegtes JWT-Secret in `server.js` sowie ein Admin-Passwort im Klartext in `admin.json` — in einem **öffentlichen** Repository. Beides wurde aus dem aktuellen Code entfernt. Falls jemals ein Admin-Konto mit dem in `admin.json` enthaltenen Passwort angelegt wurde, **sollte dieses Passwort jetzt geändert werden** — der alte Wert war öffentlich einsehbar und muss unabhängig von der Codekorrektur als kompromittiert gelten. Ein neues Admin-Konto lässt sich über `POST /register` mit `"role": "admin"` anlegen.

## Bekannte Lücke

`telc-frontend` ruft auf diesem Backend die Endpunkte `/exams` und `/questions` auf, die im aktuellen `server.js` nicht implementiert sind — hier existieren nur `/register` und `/login`. Falls das laufende Deployment diese Routen dennoch bereitstellt, ist der dort laufende Code weiter als das, was in diesem Repository commitet ist — sollte vor weiterer Arbeit abgeglichen werden.
