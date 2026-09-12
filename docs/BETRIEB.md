# Dauerbetrieb

Wie der Desk läuft, ohne dass dein Rechner anbleiben muss.

---

## Die eine Bedingung

Der Desk ist **kein Request-Handler**, sondern ein laufender Prozess: Er tickt
alle paar Sekunden, ob jemand zusieht oder nicht, und hält das Buch zwischen den
Ticks im Speicher.

**Damit fällt Serverless aus.** Auf Vercel, Netlify oder Cloudflare Workers ist
jeder Aufruf eine eigene, kurzlebige Instanz — die Tick-Schleife überlebt das
nicht, der SSE-Stream wird gekappt, und der Orchestrator existiert bei jedem
Request neu. Das ist die naheliegendste Falle, weil Vercel für Next.js sonst die
Standardantwort ist.

Was funktioniert: alles, was einen Container am Leben hält.

| Weg | Passt für |
|---|---|
| **Raspberry Pi / alter Rechner zu Hause** | Kostenlos, läuft im eigenen Netz, kein Fremdzugriff |
| **Kleiner VPS** (Hetzner ab ~4 €/Monat) | Erreichbar von überall, volle Kontrolle |
| **Fly.io / Railway / Render** | Am wenigsten Einrichtung, Container direkt aus dem Repo |

---

## Vorher: Persistenz prüfen

Ohne dauerhaften Speicher verliert jeder Neustart das Buch — und danach zeigt
das Terminal einen frischen Stand, während die eröffneten Positionen noch offen
sind und **kein Stop-Loss mehr für sie ausgewertet wird**.

Der Desk schreibt seinen Zustand nach `DATA_DIR` (Standard: `./data`), atomar
nach jedem Tick. Prüfen:

```bash
npm run build && npm start
# ein paar Positionen abwarten, dann hart abschießen:
pkill -9 -f next-server
npm start
```

Im Signal-Feed muss danach stehen: `Book restored from disk — N open position(s)`.

Ein Neustart hebt das Tagesverlustlimit übrigens **nicht** auf — der Bezugspunkt
wird mitgespeichert. Sonst wäre Neustarten der Weg um das eigene Limit herum.

---

## Mit Docker (empfohlen)

```bash
docker compose up -d --build
```

Läuft auf Port 3000, startet nach einem Reboot von selbst neu, und das Buch
liegt im Volume `desk-data`. Optionale Keys kommen aus `.env.local`, falls
vorhanden.

```bash
docker compose logs -f          # zusehen
docker compose restart          # neu starten, Buch bleibt
docker compose down             # anhalten, Buch bleibt
docker compose down -v          # anhalten UND das Buch löschen
```

**Das Volume ist der wichtige Teil.** Ohne `-v desk-data:/data` fängt jeder
Container-Neustart bei null an.

## Ohne Docker, auf einem Linux-Rechner

```ini
# /etc/systemd/system/memedesk.service
[Unit]
Description=MEMEDESK
After=network-online.target

[Service]
Type=simple
User=deinuser
WorkingDirectory=/opt/memedesk
Environment=NODE_ENV=production
Environment=DATA_DIR=/var/lib/memedesk
Environment=MARKET_MODE=auto
ExecStart=/usr/bin/node .next/standalone/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /var/lib/memedesk && sudo chown deinuser /var/lib/memedesk
sudo systemctl enable --now memedesk
journalctl -u memedesk -f
```

---

## Erreichbarkeit

| Wo es läuft | Wie du drankommst |
|---|---|
| Zu Hause (Pi, Laptop) | `npm run phone` zeigt LAN-Adresse und QR-Code. Nur im eigenen WLAN |
| VPS / Cloud | Öffentliche IP oder Domain |

**Bei allem, was aus dem Internet erreichbar ist:** Der Desk kennt keine Nutzer.
Wer die Adresse hat, kann den Kill-Switch drücken, Tickets freigeben und das
Buch zurücksetzen. Vor einem öffentlichen Deployment gehört mindestens ein
Reverse-Proxy mit Basic Auth davor — oder besser: gar nicht öffentlich, sondern
über Tailscale oder WireGuard ins eigene Netz.

Solange es Paper-Trading ist, ist das Risiko ein zerstörter Testlauf. Mit einer
echten Wallet wäre es Geld.

---

## Was im Dauerbetrieb zu beobachten ist

| Wo | Worauf |
|---|---|
| Statusleiste unten | Fällt eine Chain dauerhaft auf `simulated`, liefert die Quelle nichts mehr |
| Warum/Warum-nicht → `fresh launches` | Bleibt das über Stunden bei 0, ist die Discovery tot |
| Agenten-Desk, Tick-Zähler | Steht der Zähler, hängt der Desk |
| Signal-Feed | `Could not save the book` heißt: Platte voll oder Rechte falsch |

Der Simulator retiriert Token nach ihrer Lebensdauer, das Universum altert, und
die Zahlen bleiben auch nach Tagen in glaubwürdigen Bereichen — das war vorher
nicht so und ist der Grund, warum ein wochenlanger Lauf jetzt überhaupt Sinn
ergibt.
