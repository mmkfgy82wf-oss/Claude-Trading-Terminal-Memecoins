# MEMEDESK — Projektdokumentation

Vollständige Aufzeichnung dessen, was geplant, entschieden, gebaut und geprüft
wurde. Stand: 11. September 2026.

---

## 1. Auftrag und Interview

**Auftrag:** Ein autonomes Memecoin-Trading-Terminal mit schönem Design,
Animationen und mehreren zusammenarbeitenden Agenten, die den Markt im Blick
behalten.

Da mehrere Auslegungen zu deutlich unterschiedlicher Arbeit geführt hätten,
habe ich vor dem Bauen zwei Interviewrunden geführt. Deine Antworten:

| Frage | Entscheidung |
|---|---|
| Echte Trades oder Simulation? | **Zuerst Paper-Trading mit echten On-Chain-Daten**, Wallet-Anbindung für später vorbereiten |
| Welche Chain? | **Solana + Robinhood Chain** |
| Wie soll es laufen? | **Next.js Web-Terminal, dunkles Neon-Design** |
| Woher die Daten? | **DexScreener + optionale Keys** (Birdeye/Helius) |
| Wie denken die Agenten? | **Deterministische Engine + optionaler Claude-Layer** |
| Wie autonom? | **Autonom, aber per Toggle auf Freigabe-Modus umschaltbar** |
| Kapital & Risiko | **10 SOL, aggressives Profil** |

### Eine Einschränkung, die ich zuerst falsch eingeschätzt hatte

Ich bin anfangs davon ausgegangen, **Robinhood Chain** sei zu jung für
öffentliche DEX-Indizierung, und habe sie deshalb als simuliert ausgeliefert.
Das war veraltet: Die Chain ist seit **1. Juli 2026** im Mainnet (Arbitrum
Orbit, Chain ID 4663, Gas in ETH) und lag im Juli 2026 unter den Top 5 nach
DEX-Volumen, mit Uniswap als Launch-Partner. Es gibt dort also sehr wohl echte
Daten.

Behoben durch **Slug-Autoerkennung**: Aggregatoren benennen Chains
unterschiedlich und nehmen sie spät auf, deshalb rät der Adapter nicht mehr auf
einen Namen, sondern probiert eine Kandidatenliste und rastet auf den Slug ein,
unter dem die API tatsächlich antwortet. Der erkannte Slug steht in der
Statusleiste. `npm run check-chains` zeigt es dir vorab.

Die Simulator-Umschaltung bleibt als Sicherheitsnetz: Liefert eine Chain
gerade nichts, läuft sie sichtbar simuliert (`SIMULATED`-Badge pro Chain,
`SIM`-Marker pro Paar) statt erfundene Zahlen als live auszugeben.

---

## 2. Was gebaut wurde — Architektur

```
Markt-Feed ──▶ Blackboard ──▶ 6 Agenten ──▶ Konsens ──▶ Risk ──▶ Executor ──▶ Paper-Wallet
   │                                                                              │
   └── DexScreener live / Simulator-Fallback                        SSE ──▶ Next.js UI
```

### 2.1 Das Blackboard-Muster (die "Zusammenarbeit")

Die Agenten rufen einander **nie direkt auf**. Sie lesen den gemeinsamen
Arbeitsspeicher (`src/lib/agents/blackboard.ts`) und schreiben ihr eigenes
Urteil zurück. Das hat drei konkrete Vorteile:

- Die Reihenfolge ist austauschbar, ein Agent kann entfernt oder ergänzt werden,
  ohne die anderen anzufassen.
- Jede Entscheidung ist prüfbar: Wer hat wann was mit welcher Begründung gesagt.
  Genau das rendert die UI im aufklappbaren **Audit-Trail** jeder Zeile.
- Der Konsens ist eine Funktion über die Signale, kein Verhandlungsprotokoll.

### 2.2 Die sechs Agenten

| Agent | Rolle | Was er tatsächlich prüft |
|---|---|---|
| **SCOUT** ◈ | Discovery | Handelbarkeit (Liquidität vs. eigenem Floor), Turnover (Volumen ÷ Pool), Frische (Pair-Alter), Aufmerksamkeit (5m-Volumen-Burst gegen die eigene 24h-Laufrate). Reduziert hunderte Paare auf 14. |
| **SENTINEL** ⛨ | Rug-Abwehr | Pool-Tiefe, FDV-zu-Liquidität-Verhältnis, Honeypot-Muster (Buys ohne Sells), Sell-Kaskaden, Alter. Mit Keys zusätzlich: Top-10-Holder-Anteil (Birdeye), aktive Mint-/Freeze-Authority (Helius). **Einziger Agent mit Vetorecht.** |
| **QUANT** ∿ | Momentum & Flow | Multi-Timeframe-Trend, Order-Flow-Imbalance, Volumen-Beschleunigung, **Extension-Penalty** (kauft keine bereits senkrechte Kerze), realisierte Volatilität, Trendsteigung aus der eigenen Preishistorie. Schwerste Stimme im Konsens. |
| **NARRATOR** ❝ | Narrativ | Meme-Lexikon-Treffer, Ticker-Aussprechbarkeit, "abgeleitete" Namen (V2, SAFE…), Crowd-Struktur (viele kleine Tickets = Menge, wenige große = ein Desk). Mit `ANTHROPIC_API_KEY` zusätzlich eine Claude-Lesung, die zu 40 % einfließt — nie beherrschend. |
| **RISK** ⚖ | Sizing & Exposure | Positionsgröße nach Überzeugung, Positions-Cap, Exposure-Cap, Cash, maximaler Ticket-Anteil am Pool, projizierte Slippage, Tagesverlustlimit, Kill-Switch. Der einzige Ort, an dem entschieden wird, wie viel Risiko läuft. |
| **EXECUTOR** ▶ | Fills & Exits | Führt freigegebene Tickets aus und verwaltet **jeden Ausstieg selbstständig**: Stop-Loss, Take-Profit-Leiter, Trailing-Stop, spätes SENTINEL-Veto, Liquiditätsverfall, Kill-Switch. |

**Konsens-Gewichtung:** QUANT 0.5, NARRATOR 0.3, SCOUT 0.2, jeweils zusätzlich
mit der Confidence des Agenten skaliert. SENTINEL hat bewusst **kein Gewicht** —
ein Veto ist stärker als jede Gewichtung es ausdrücken könnte und kappt den
Score hart auf ≤ −60.

### 2.3 Eine Treasury pro Chain

**Kapital wandert nicht von selbst zwischen Chains.** Auf Solana zahlst du mit
SOL, auf einer EVM-L2 mit ETH — dein SOL liegt dort schlicht nicht. Das Buch
hält deshalb **pro Chain eine eigene Kasse im jeweiligen Quote-Asset**:

| Chain | Quote-Asset | Gebührenmodell |
|---|---|---|
| Solana | **SOL** | DEX-Fee + Priority-Fee, hoch genug für einen umkämpften Block |
| Robinhood Chain | **ETH** | L2-Gas, absolut günstig, aber ETH ist pro Einheit weit mehr wert |

Ein Ticket auf einem RHC-Paar wird in ETH dimensioniert, aus der ETH-Kasse
bezahlt und mit L2-Gas belastet — die SOL-Kasse wird nie berührt. Ist die Kasse
einer Chain leer, entstehen dort keine Tickets, egal wie bullisch der Konsens
ist. Aggregate (Equity, P/L, Equity-Kurve) laufen in **USD**, weil das die
einzige Einheit ist, die auf beiden Chains dasselbe bedeutet.

### 2.4 Handels-Regeln (aggressives Profil, zur Laufzeit änderbar)

- Buchgröße $1.800 (≈ 10 SOL beim Start), gleichmäßig auf die Chain-Kassen verteilt
- max. 15 % pro Position · max. 6 offene Positionen
- max. 70 % Gesamtexposure, **pro Chain gegen deren eigene Kasse geprüft**
- Stop-Loss −25 %
- Take-Profit-Leiter +50 % / +150 % / +400 % (verkauft 40 % / 35 % / Rest)
- Trailing-Stop −30 %, **scharf erst nach der ersten TP-Stufe** — sonst würde
  normales Memecoin-Rauschen jeden Einstieg sofort ausstoppen
- max. 3 % Slippage bei Einstiegen; **Ausstiege werden nie durch Slippage
  blockiert** — in einem Rug festzustecken ist schlimmer als ein schlechter Fill
- Tagesverlustlimit −35 % stoppt neue Einstiege — **aufhebbar durch den
  Operator** (`RESUME` setzt den Bezugspunkt neu, `RESET BOOK` startet den Lauf
  neu). Ohne Eingriff fällt die Sperre erst nach 24 h

### 2.5 Slippage- und Kostenmodell

Fills sind nicht der Mittelkurs. Die Slippage wächst quadratisch mit dem
Verhältnis Order zu Pool (`estimateSlippagePct`), dazu kommen DEX- und
Gas-Kosten **der jeweiligen Chain**. Ein 2-SOL-Ticket in einen 12k-Pool tut weh — und das Terminal
soll das spüren, sonst sind die Papierergebnisse wertlos.

### 2.6 Marktdaten

**Discovery und Pricing sind getrennte Quellen.** Eine Textsuche findet, was so
heißt — also etablierte Token. Ein Coin von vor zehn Minuten hat einen Namen,
den niemand kennt und nach dem folglich niemand sucht. Deshalb fragt der Feed
**pump.fun** (das grösste Solana-Launchpad, Vorschlag des Nutzers), was neu ist,
und löst die Mint-Adressen dann über DexScreener in echte Paardaten auf.

Preise, Liquidität und Volumen kommen nie vom Launchpad: Vor der Graduation
handeln pump.fun-Token gegen eine Bonding Curve statt gegen einen Pool, und das
Slippage-Modell des Desks setzt einen Pool voraus. So bleiben alle Agenten und
das gesamte Ausführungsmodell unverändert.

Zwei Kohorten werden geholt: frisch gelauncht (maximale Asymmetrie, kaum
Information — SENTINEL vetoed die meisten zu Recht auf Liquidität) und kurz vor
der Graduation (Kurve gefüllt, echtes Geld drin, Migration in einen echten Pool
steht an — hier greifen die Liquiditätsschwellen tatsächlich).

pump.fun hat **keine offizielle Daten-API**; genutzt wird die undokumentierte
Frontend-API. Der Parser toleriert deshalb umbenannte und fehlende Felder, und
das Modul liefert im Zweifel eine leere Liste statt einen Tick zu brechen.
`npm run check-sources` prüft das gegen die echte API.

- **Live:** DexScreener-Suche für Discovery, gebündelte Pair-Abfragen (30 pro
  Request) für Refreshes. Preishistorie wird über Refreshes hinweg gehalten,
  damit die Charts durchgehend bleiben.
- **Fallback:** Ein Memecoin-**Simulator** mit Archetypen (Runner, Pumper,
  Slow-Burner, Ruggable, Dead) inklusive echter Lifecycle-Ereignisse:
  Liquiditätsabzug, Sell-Kaskade, Wiederbelebung. Kein reiner Random-Walk —
  Agenten sind nur gegen einen Feed testbar, der diese Regime reproduziert.
- **Umschaltung:** pro Chain automatisch, sichtbar in der Statusleiste unten.

### 2.7 Live-Wallet-Anbindung (vorbereitet, bewusst inaktiv)

`src/lib/trading/executor.ts` definiert das Interface `TradeExecutor`.
`PaperExecutor` ist die aktive Implementierung. `LiveSolanaExecutor` ist die
Naht für später: gleiches Interface, gleiche Aufrufstellen. Sie verweigert die
Arbeit, solange nicht **beides** vorliegt — ein Signer *und*
`ENABLE_LIVE_TRADING=yes-i-accept-the-risk`. Damit kann kein
Konfigurationsversehen Paper-Trading in echte Orders verwandeln.

Der Weg zum Scharfschalten: Keypair aus einem eigenen Signer laden → Jupiter-
Quote holen → Swap bauen, signieren, senden, bestätigen → bestätigte Transaktion
auf ein `Fill` mappen. Die Agenten-Pipeline ändert sich dabei nicht.

Wichtig: Es braucht **einen Executor pro Chain**. Ein Solana-Signer kann keinen
Trade auf einer EVM-L2 abwickeln — genau deshalb ist das Buch oben pro Chain
getrennt.

---

## 3. Die Oberfläche

> Panel für Panel, mit der Bedeutung jeder einzelnen Zahl:
> **[docs/TERMINAL.md](docs/TERMINAL.md)**. Der folgende Abschnitt beschreibt
> nur den Aufbau und die Gestaltungsentscheidungen.

### Layout
Drei-Spalten-Desk auf großen Bildschirmen, einspaltig auf dem Handy. Jedes Panel
scrollt in seinem eigenen Rahmen; die Seite selbst scrollt nie horizontal.

- **Links:** Agenten-Desk (Status, aktuelle Tätigkeit, Auslastungsbalken,
  Entscheidungszähler), **Warum/Warum-nicht-Panel** und Freigabe-Queue
- **Rechts unten:** Trade-Log mit zwei Ansichten — abgeschlossene Round Trips
  (Ausgang, Rendite, Haltedauer, Ausstiegsgrund, Gewinnfaktor) und darunter
  umschaltbar die einzelnen Fills
- **Mitte:** Paper-Portfolio (Equity-Hero in USD, Equity-Kurve, **eine
  Treasury-Karte pro Chain mit dem echten nativen Bestand**, Kennzahlen),
  Konsens-Board (aufklappbarer Audit-Trail), offene Positionen mit sichtbarem
  Ausstiegsplan
- **Rechts:** Signal-Feed (jede Agenten-Entscheidung, farbcodiert nach Agent),
  Execution-Tape
- **Oben:** Ticker-Tape, Autonomie-Toggle, Risk-Panel, Kill-Switch
- **Unten:** Datenherkunft pro Chain (live vs. simuliert, im Klartext)

### Animationen
Boot-Sequenz, laufendes Ticker-Band (pausiert bei Hover), pulsierende
Statuspunkte, Scanline, Feder-animierte Balken, Fade-in neuer Log- und
Fill-Zeilen, Flash auf neuen Fills, Layout-animierter Autonomie-Toggle,
Slide-in-Drawer. **Alles respektiert `prefers-reduced-motion`** — dort werden
sämtliche Animationen abgeschaltet, inklusive Überspringen der Boot-Sequenz.

### Das Warum/Warum-nicht-Panel

Ein autonomer Desk, dessen Untätigkeit man nicht lesen kann, ist nicht
vertrauenswürdig — egal wie gut die Logik ist. Das Panel beantwortet deshalb
zwei Fragen direkt:

- **Woher kommen diese Token?** Frische Launches vs. Suchtreffer, wie viele neu
  dazukamen, wie viele ausgealtert sind, Medianalter der Watchlist.
- **Warum wurde nichts gekauft?** Der Trichter vom Board bis zum Ticket:
  vetoed → unter Konsens-Schwelle → schon gehalten → kein Slot → Kasse leer →
  Slippage → zu klein → dimensioniert. Darüber ein Satz, der die letzte Hürde
  benennt, an der es hängt.

Der Unterschied zwischen „der Desk ist ruhig" und „der Desk klemmt" ist von
außen sonst nicht erkennbar. Genau diese Mehrdeutigkeit hat den Nutzer eine
halbe Stunde gekostet.

### Farben — und warum sie so gewählt sind
Die Agenten-/Serienfarben sind kein Bauchgefühl, sondern gegen die dunkle
Oberfläche `#0a0b10` **rechnerisch validiert**: Helligkeitsband, Chroma-Floor,
CVD-Trennung benachbarter Paare (Delta E 9.1, Ziel ≥ 8) und Kontrast ≥ 3:1
bestehen alle. Die neonhellen `-glow`-Varianten sind ausschließlich Chrome
(Ränder, Schatten, Hover) und nie eine Datenmarkierung.

Gewinn/Verlust nutzt Grün/Rot — ein Paar, das für Rot-Grün-Schwäche grundsätzlich
schwierig ist. Deshalb trägt **jede** P/L-Zahl zusätzlich ein ▲/▼ und ein
Vorzeichen; die Farbe ist nie die einzige Information. Dasselbe gilt für die
Agenten: jeder hat neben seiner Farbe ein Glyph und sein Call-Sign.

---

## 4. Was geprüft wurde

### Unit-Tests — 58, alle grün (`npm test`)
- Slippage wächst mit dem Order-zu-Pool-Verhältnis; leerer Pool ist unfüllbar
- Ein Kauf belastet Cash und legt den Ausstiegsplan an der Position ab
- Ein profitabler Round-Trip bucht realisierten Gewinn und zählt als Win
- Teilverkauf lässt den Rest offen, merkt sich die Stufe und **skaliert die
  Kostenbasis mit** (sonst wäre jedes folgende P/L falsch)
- Einstiege über Slippage-Budget werden verweigert
- Ausstiege werden nie durch Slippage blockiert
- Risk-Patches aus der UI werden geklemmt, nicht vertraut
- Tagesverlust wird gegen den Sitzungs-Anker gemessen
- **Eine gerissene Sperre löst sich nicht von selbst, nur weil Positionen
  geschlossen wurden** — genau deshalb braucht es einen Ausweg
- **Re-Arm hebt die Sperre auf und lässt Buch, Positionen und realisiertes
  Ergebnis unangetastet** — der Verlust bleibt auf dem Konto, nur der Bezugspunkt
  wandert
- **Ein Reset startet den Lauf bei der konfigurierten Buchgröße neu** und ist
  nicht sofort wieder gesperrt
- **Ein Robinhood-Chain-Trade wird in ETH notiert, aus der ETH-Kasse bezahlt und
  rührt die SOL-Kasse nicht an**
- **Jedes Ticket trägt das Quote-Asset seiner eigenen Chain und passt in deren Kasse**
- **Eine Chain mit leerer Kasse erzeugt keine Tickets, egal wie bullisch sie aussieht**
- Das Buch weist jede Chain in ihrem eigenen Quote-Asset aus
- SCOUT rankt tiefen, aktiven Pool über toten
- SENTINEL vetoed Honeypot-Muster und Sell-Kaskaden, lässt Gesundes durch
- QUANT bevorzugt konstruktiven Flow und diskontiert bereits gelaufene Bewegungen
- Ein Veto überstimmt einen bullischen Konsens vollständig
- RISK sized nie einen vetoed Namen und respektiert das Positionslimit
- RISK hält Tickets innerhalb Positions- **und** Exposure-Cap
- Kill-Switch verhindert jedes Öffnen von Risiko
- Tagesverlustlimit stoppt neue Einstiege

### Laufzeit-Test gegen den laufenden Server
Die vollständige Pipeline wurde live beobachtet: SCOUT → SENTINEL-Veto → QUANT →
RISK-Sizing → EXECUTOR-Fill, inklusive eines Veto-getriebenen Notausstiegs
(`SELL WOJAKR · 100% · −0.091 SOL · sentinel veto: sell cascade in progress`).
Kill-Switch liquidierte alle 6 Positionen; Manual-Modus erzeugte
Freigabe-Tickets; ein freigegebenes Ticket wurde korrekt gefüllt.

### Visuelle Prüfung im echten Browser
Screenshots bei 1680 px und 400 px, geprüft auf horizontalen Overflow und
Konsolenfehler. Beides sauber.

### Drei echte Fehler, die dabei gefunden und behoben wurden

1. **Exposure-Limit war in Summe umgehbar.** RISK berechnete den Headroom einmal
   pro Tick und maß jedes Ticket gegen denselben Startwert — mehrere Tickets
   eines Ticks konnten das Limit gemeinsam sprengen. Headroom und Cash werden
   jetzt beim Ausgeben der Tickets verbraucht. *Der Test dafür war es, der den
   Fehler aufgedeckt hat.*
2. **Freigabe-Queue lief voll.** Im Manual-Modus wurden Tickets weiter erzeugt,
   obwohl keine Slots frei waren — 12 Tickets, die nie alle hätten genommen
   werden können, jedes davon veraltend gegenüber dem Setup, für das es
   dimensioniert wurde. Die Queue-Tiefe ist jetzt an die freien Slots gebunden.
3. **Tabellenzeilen sprangen.** Layout-Animationen auf `<tr>` kollabierten
   Zeilenhöhen; ersetzt durch ein reines Fade.
4. **Jeder Trade wurde in SOL gebucht — auch auf Robinhood Chain.** Der Executor
   rechnete grundsätzlich über den SOL-Preis um und zog Solana-Priority-Fees ab,
   sodass ein RHC-Paar als „0.491 SOL" im Buch stand. Auf einer EVM-L2 ist aber
   ETH das Quote-Asset, und SOL existiert dort nicht. Behoben durch die
   Treasury-pro-Chain aus Abschnitt 2.3. *Diesen Fehler hat der Nutzer gefunden,
   nicht ich* — meine Tests prüften Beträge, aber nie deren Währung. Die drei
   neuen Tests oben schließen die Lücke.

---

## 5. Bekannte Grenzen

- **Chain-Abdeckung wird zur Laufzeit erkannt.** Antwortet eine Chain gerade
  nicht, läuft sie sichtbar simuliert. Mit `npm run check-chains` siehst du
  ohne Umweg, was bei dir live ist und unter welchem Slug.
- ~~Der Zustand lebt im Prozess.~~ **Behoben:** Das Buch wird atomar nach
  `DATA_DIR` geschrieben und beim Start wiederhergestellt, inklusive des
  Bezugspunkts für das Tagesverlustlimit — ein Neustart ist kein Weg um das
  eigene Limit herum.
- **Ein einzelner Desk-Prozess.** Der Orchestrator ist ein Singleton auf
  `globalThis`; für mehrere Nutzer bräuchte es eine Instanz pro Sitzung.
- **Der Simulator ist plausibel, nicht kalibriert.** Er reproduziert Regime,
  ist aber nicht gegen historische Memecoin-Daten gefittet. Papier-Ergebnisse
  im Simulator sagen nichts über Live-Erträge.
- **Kein Backtest.** Die Agenten sind gegen konstruierte Szenarien getestet,
  nicht gegen historische Serien.

## 6. Naheliegende nächste Schritte

1. Paper-Wallet und Fill-Historie persistieren (JSON-Snapshot pro Tick)
2. Backtest-Modus: Feed durch historische DexScreener-Kerzen ersetzen und die
   Agenten unverändert darüber laufen lassen
3. Live-Wallet: `LiveSolanaExecutor` mit Jupiter-Quotes implementieren, hinter
   dem bestehenden Doppel-Opt-in
4. Zweite Meinung für QUANT (ein zweites Modell, das gegen ihn stimmen darf)
5. Positions-Detailansicht mit Kerzen statt Sparkline

---

## 7. Dateiübersicht

```
src/lib/types.ts                 Gemeinsames Vokabular (auch das SSE-Wire-Format)
src/lib/market/chains.ts         Chain-Registry (Solana, Robinhood Chain)
src/lib/market/dexscreener.ts    Live-Client (Pricing), fällt nie hart aus
src/lib/market/pumpfun.ts        Launchpad-Discovery: was ist neu?
src/lib/market/simulator.ts      Memecoin-Simulator mit Archetypen
src/lib/market/feed.ts           Vereinheitlichter Feed, live ↔ simuliert
src/lib/market/providers.ts      Optionale Anreicherung (Birdeye, Helius, SOL-Preis)
src/lib/agents/blackboard.ts     Gemeinsamer Arbeitsspeicher + Konsensbildung
src/lib/agents/roster.ts         Agenten-Stammdaten, validierte Farbslots
src/lib/agents/base.ts           Agenten-Basisklasse
src/lib/agents/{scout,sentinel,quant,narrator,risk,executor}.ts
src/lib/agents/orchestrator.ts   Tick-Loop, Kommandos, Snapshots, SSE-Verteilung
src/lib/trading/risk.ts          Risikoprofile + Klemmung von UI-Patches
src/lib/trading/executor.ts      TradeExecutor-Interface, Paper + Live-Naht
src/lib/trading/wallet.ts        Paper-Buch: eine Treasury je Chain, Aggregate in USD
src/app/api/{stream,control,state}/route.ts
src/components/*.tsx             Terminal-Oberfläche
tests/*.test.ts                  58 Unit-Tests
```
