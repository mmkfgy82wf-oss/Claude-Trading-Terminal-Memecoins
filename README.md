# MEMEDESK — Autonomous Memecoin Trading Terminal

Ein autonomes Multi-Agenten-Trading-Terminal für Memecoins. Sechs Agenten
beobachten den Markt gemeinsam, stimmen über Kandidaten ab und handeln
eigenständig — als **Paper-Trading auf echten On-Chain-Daten**.

![Terminal](docs/screenshot-desktop.png)

## Schnellstart

```bash
npm install
npm run dev          # http://localhost:3000
```

Das war's — kein API-Key nötig. Das Terminal startet, verbindet sich mit
DexScreener und beginnt sofort zu handeln.

### Optionale Keys

```bash
cp .env.example .env.local
```

| Variable | Was es freischaltet |
|---|---|
| `BIRDEYE_API_KEY` | Holder-Konzentration (Top-10-Wallet-Anteil) für SENTINEL |
| `HELIUS_API_KEY` | Mint-/Freeze-Authority-Check → harte Veto-Signale |
| `ANTHROPIC_API_KEY` | NARRATOR lässt zusätzlich Claude die Story eines Tickers lesen |
| `MARKET_MODE` | `auto` (Standard), `live` oder `simulated` |
| `TICK_INTERVAL_MS` | Taktrate der Agenten (Standard 4000) |

Ohne Keys läuft alles vollständig — nur mit weniger Signalquellen.

## Befehle

```bash
npm run dev        # Entwicklungsserver
npm run build      # Produktions-Build
npm start          # Produktionsserver
npm test           # Unit-Tests (17)
npm run typecheck  # TypeScript ohne Emit
```

## Sicherheit

Das Terminal handelt **ausschließlich mit virtuellem Kapital**. Es gibt keinen
Private Key, keine Wallet-Anbindung und keinen Code-Pfad, der eine echte
Transaktion signiert. Die Live-Execution-Schicht (`LiveSolanaExecutor`) ist
bewusst funktionslos und verweigert die Arbeit, solange kein Signer *und* ein
expliziter Opt-in-Flag gesetzt sind.

Vollständige Dokumentation: **[PROJEKT.md](PROJEKT.md)**
