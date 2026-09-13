# Das Terminal lesen

Was pro Tick passiert, und was jede Zahl auf dem Bildschirm bedeutet.

![Terminal](screenshot-desktop.png)

---

## 1. Was in einem Tick passiert

Standardtakt 4 Sekunden (`TICK_INTERVAL_MS`). Jeder Tick läuft dieselben
sieben Schritte, immer in dieser Reihenfolge:

| # | Schritt | Was dabei geschieht |
|---|---|---|
| 1 | **Feed pollen** | Alle 60 s neue Discovery (Launchpad + Suche), dazwischen nur Preis-Refresh der bekannten Paare. Veraltete Paare fallen raus. |
| 2 | **SCOUT** ◈ | Rankt das ganze Universum, gibt die besten 14 als Watchlist weiter |
| 3 | **SENTINEL** ⛨ | Prüft jeden Kandidaten auf Rug-Marker. Findet er welche → **Veto** |
| 4 | **QUANT** ∿ | Bewertet Momentum, Flow, Volumenbeschleunigung, Überdehnung |
| 5 | **NARRATOR** ❝ | Bewertet die Story; mit API-Key zusätzlich eine Claude-Lesung |
| 6 | **RISK** ⚖ | Bildet den Konsens, prüft alle Limits, dimensioniert Tickets |
| 7 | **EXECUTOR** ▶ | Führt Tickets aus **und** verwaltet jeden Ausstieg |

Schritt 7 läuft **immer**, auch wenn RISK blockiert ist. Aussteigen ist nie
gesperrt — weder durch Limits noch durch den Freigabe-Modus.

Die Agenten reden nicht miteinander. Jeder liest den gemeinsamen Stand und
schreibt sein Urteil zurück. Deshalb kannst du im Konsens-Board jede
Entscheidung aufklappen und sehen, wer was gesagt hat.

---

## 2. Panel für Panel

### Kopfzeile

| Element | Bedeutung |
|---|---|
| `STREAM LIVE` | Die Browser-Verbindung zum Desk steht. Bei `RECONNECTING` läuft der Desk weiter, nur die Anzeige hängt |
| `ON-CHAIN DATA` / `SIMULATED FEED` | Echte Marktdaten oder Simulator. **Entscheidend** — im Simulator bedeutet kein Ergebnis irgendetwas |
| `PAPER` | Virtuelles Geld. Verschwindet nie, solange keine Live-Wallet angebunden ist |
| `EQUITY $2.0K ▲ +9.8%` | Gesamtbuch in USD über alle Chains, plus Veränderung seit Start |
| `AUTO` / `MANUAL` | AUTO füllt eigene Tickets, MANUAL legt jedes in die Freigabe-Queue |
| `⚙ RISK` | Öffnet die Risikoparameter, wirksam ab dem nächsten Tick |
| `KILL SWITCH` | Verkauft **sofort alles** und sperrt neue Einstiege bis zur Freigabe |

### Ticker-Tape

Laufband der Watchlist mit Preis und 1h-Änderung. **Mauszeiger drauf hält es an**,
damit man ein Symbol lesen kann.

### Agenten-Desk (links oben)

Eine Karte pro Agent:

```
◈  SCOUT  DISCOVERY                          20
   ● ACTING  watchlist: 14 of 44             0s
   ████████████████░░░░░░░░
```

| Element | Bedeutung |
|---|---|
| Glyph + Name | Der Agent. Farbe und Glyph gehören zusammen — die Farbe allein trägt nie Information |
| Statuspunkt | `idle` wartet · `analysing` rechnet · `acting` hat entschieden · `blocked` kommt nicht weiter |
| Text daneben | Was der Agent **gerade konkret tut** |
| Zahl rechts | Entscheidungen seit Sitzungsbeginn · darunter, wann zuletzt aktiv |
| Balken | Auslastung, 0–100 % |
| `+AI` | Optionale Anreicherung aktiv (Birdeye/Helius bei SENTINEL, Claude bei NARRATOR) |

**`RISK · BLOCKED` ist normal**, nicht kaputt: Es heißt meist, dass alle
Positionsplätze belegt sind. Warum genau, steht im Panel darunter.

### Warum / Warum nicht (links Mitte)

Das Panel, das die Frage „passiert hier gerade nichts, oder ist etwas kaputt?"
beantwortet.

**Oben ein Satz** — die letzte Hürde, an der es hängt:

> *All 6 position slots are full — nothing new until one exits.*

**DISCOVERY** — woher die Token kommen:

| Feld | Bedeutung |
|---|---|
| `fresh launches` | Vom Launchpad (pump.fun). **Steht hier 0 bei Live-Daten, kommt nichts Neues rein** |
| `from search` | Aus der DexScreener-Suche — das sind eher etablierte Coins |
| `new this cycle` | Wie viele Paare in diesem Discovery-Zyklus dazukamen |
| `aged out` | Wie viele als veraltet entfernt wurden |
| `44 tracked → 14 watched` | Größe des Universums → Größe der Watchlist |
| `median age` | Medianalter der Watchlist. **Steigt das dauerhaft, altert dein Board** |

**SIZING FUNNEL** — wo jeder Kandidat gestorben ist:

| Zeile | Bedeutung |
|---|---|
| `vetoed by SENTINEL` | Rug-Marker gefunden |
| `below consensus score` | Zu schwach. Die häufigste Zeile, und meist korrekt |
| `already held` | Qualifiziert, aber schon im Depot |
| `no free slot` | Positionslimit erreicht |
| `chain treasury empty` | Kasse **dieser** Chain leer — SOL zahlt keinen ETH-Trade |
| `slippage over budget` | Pool zu dünn für diese Ticketgröße |
| `ticket too small` | Unter der Mindestgröße |
| `sized into a ticket` | **Durchgekommen** — nur diese Zeile führt zu einem Kauf |

**FEEDS** — Live/simuliert pro Chain, Anzahl Paare, neue Launches.

**Bei gerissenem Tagesverlustlimit** erscheint hier zusätzlich ein roter Block
mit dem aktuellen Drawdown, der Angabe, wann die Sperre von selbst fällt, und
zwei Knöpfen:

| Knopf | Wirkung |
|---|---|
| `RESUME` | Setzt den Bezugspunkt des Limits auf die **aktuelle** Equity. Positionen, Historie und realisiertes Ergebnis bleiben — der Lauf geht weiter, der Verlust bleibt auf dem Konto |
| `RESET BOOK` | Startet den Lauf **neu**: Kassen wieder auf die Buchgröße, keine Positionen, keine Historie |

Ohne Eingriff bleibt die Sperre bis zu 24 Stunden bestehen. Das ist Absicht:
Ein Limit, das sich selbst aufhebt, ist kein Limit. Aber im Paper-Trading willst
du beobachten, nicht warten — deshalb die beiden Knöpfe.

### Paper-Portfolio (Mitte oben)

| Element | Bedeutung |
|---|---|
| `$1,976 total book` | Gesamtbuch in USD. USD, weil es die einzige Einheit ist, die auf beiden Chains dasselbe bedeutet |
| Prozentzahl daneben | **Gemessen gegen die Startbestände, nicht gegen eine Dollarzahl.** Siehe unten |
| Kurve | Performance über die Sitzung, **indexiert auf 100 beim Start**. Gestrichelte Linie = 100. Mauszeiger zeigt Zeitpunkt, Index und Abweichung |
| **Treasury-Karten** | Eine pro Chain, im **echten Quote-Asset**: `4.2052 SOL free` bzw. `0.1593 ETH free` |
| `free cash` | Freies Kapital über alle Kassen, in USD |
| `in positions` | Gebundenes Kapital |
| `realised` | Aus **geschlossenen** Trades |
| `unrealised` | Aus **offenen** Positionen — kann sich jederzeit wieder auflösen |
| `hit rate` | Gewinn/Verlust-Quote. `—` heißt: noch kein Trade vollständig geschlossen |

### Warum die Prozentzahl gegen Bestände misst, nicht gegen Dollar

Das Buch liegt in **SOL und ETH**, nicht in Dollar. Läge der Vergleichswert auf
einer eingefrorenen Dollarzahl, würde jeder Kursrutsch von SOL als Desk-Verlust
erscheinen — auch ohne einen einzigen Trade.

Verglichen wird deshalb mit **denselben Beständen zum heutigen Kurs**: Halte 5 SOL
durch einen SOL-Absturz, und der Desk steht bei 0 %. Der Dollarwert unten fällt
trotzdem sichtbar — das ist echt und soll sichtbar sein. Nur ist es kein
Handelsergebnis.

Dasselbe gilt fürs Tagesverlustlimit: Es misst auf demselben Verhältnis, damit
ein Kursrutsch den Desk nicht für einen Verlust sperrt, den er nicht gemacht hat.

Eine Teilverkaufs-Stufe schließt die Position **nicht** — deshalb kann die
Execution-Tape schon `SELL` zeigen, während `hit rate` noch `—` steht.

### Konsens-Board (Mitte)

Die Watchlist mit dem Urteil des Desks.

| Spalte | Bedeutung |
|---|---|
| `TOKEN` | Symbol, Chain-Tag (`SOL` / `RHC`), ggf. **`SIM`** = simuliertes Paar |
| `5M` / `1H` | Preisänderung, mit ▲/▼ — Farbe ist nie das einzige Signal |
| `LIQ` | Pool-Tiefe. Bestimmt, wie groß ein Ticket überhaupt sein darf |
| `AGE` | Alter des Paares |
| `TRACE` | Preisverlauf, grün/rot nach Richtung |
| `CONSENSUS` | Balken von der Mitte aus: rechts = positiv, links = negativ. Daneben der Wert −100…+100 |
| `VERDICT` | ⇈ `STRONG BUY` ≥72 · ↑ `BUY` ≥55 · ◎ `WATCH` ≥25 · ↓ `AVOID` · ⛔ `VETOED` |

**Zeile anklicken → Audit-Trail.** Dort steht pro Agent: sein Score, sein Label
und seine Begründungen im Klartext. Das ist der Beleg dafür, warum der Desk
etwas wollte oder nicht.

Ein ⛔ `VETOED` überstimmt alles — egal wie bullisch die anderen sind.

### Offene Positionen (Mitte unten)

```
CHONKI  SOL  0.4873 SOL @ $0.000672      ▲ +85.1%   +0.4117 SOL  [CLOSE]
────────────────────────  SL −25%  +50% +150% +400%  TRAIL −30%  29s
```

| Element | Bedeutung |
|---|---|
| Einstieg | Einsatz und Einstiegspreis **im Quote-Asset der Chain** |
| Roter Balken | Nähe zum Stop-Loss. Voll = Stop wird ausgelöst |
| `SL −25%` | Stop-Loss-Schwelle |
| `+50% +150% +400%` | Take-Profit-Stufen. **Grün hinterlegt = bereits gezogen** (verkauft 40 % / 35 % / Rest) |
| `TRAIL IDLE` / `TRAIL −30%` | Trailing-Stop scharf erst **nach der ersten TP-Stufe** — sonst würde normales Rauschen jeden Einstieg ausstoppen |
| `CLOSE` | Sofort vollständig verkaufen |

### Signal-Feed (rechts oben)

Jede Agenten-Entscheidung, neueste zuerst, eingefärbt nach Agent.

`◈` Signal · `▶` Trade · `▲` Warnung · `✖` Fehler · `▪` System

### Trade-Log (rechts unten)

Zwei Ansichten derselben Historie, umschaltbar oben rechts im Panel.

**`TRADES`** — eine Zeile pro **abgeschlossenem Round Trip**. Das ist die
Einheit, die du tatsächlich beurteilst: Eine Position, die über die
Take-Profit-Leiter ausgestiegen ist, besteht aus mehreren Verkäufen, und der
letzte davon sagt nichts darüber, ob der Trade gewonnen hat.

Kopfzeile:

| Feld | Bedeutung |
|---|---|
| `GEWONNEN / VERLOREN` | Anzahl abgeschlossener Trades je Ausgang |
| `TREFFERQUOTE` | Anteil Gewinner |
| `GEWINNFAKTOR` | Bruttogewinn ÷ Bruttoverlust. **Unter 1 verliert der Desk Geld — auch bei hoher Trefferquote** |

Der Gewinnfaktor steht bewusst daneben: Bei Memecoins kann ein Desk zwei von
drei Trades gewinnen und trotzdem verlieren, wenn der eine Verlierer größer ist
als beide Gewinner zusammen.

Pro Zeile: `WIN`/`LOSS`, Symbol, Chain, Rendite in Prozent, ein Balken für die
Größe des Ergebnisses relativ zum größten Trade im Log, das Ergebnis im
Quote-Asset, Einstiegs- → Ausstiegspreis, Haltedauer, gezogene TP-Stufen und der
Grund des letzten Ausstiegs.

**`FILLS`** — jede einzelne Ausführung: Seite, Symbol, Menge, Preis,
**tatsächliche Slippage**, bei Verkäufen das Teilergebnis. Das brauchst du,
wenn ein Trade seltsam aussieht und du sehen willst, wie er zustande kam.

Die Slippage dort ist die interessanteste Zahl des Terminals: Sie zeigt, was die
Ausführung wirklich gekostet hat.

### Freigabe-Queue (links unten)

Nur in `MANUAL` aktiv. Jedes Ticket mit Größe, Begründung und **90-Sekunden-
Countdown** — ein Memecoin-Einstieg, der eine Minute gewartet hat, ist nicht
mehr der Trade, den die Agenten dimensioniert haben. Die Queue ist auf die
Anzahl freier Plätze begrenzt.

### Risk-Panel (⚙ in der Kopfzeile)

Alle Parameter sind **live wirksam**, ab dem nächsten Tick. Die Änderung der
Buchgröße setzt das Buch zurück.

### Statusleiste (ganz unten)

Pro Chain: `live` oder `simulated`, Anzahl Paare, der erkannte DexScreener-Slug
und wann zuletzt abgefragt wurde. Hier siehst du als Erstes, wenn eine Quelle
ausfällt.

---

## 3. Alle Marker auf einen Blick

| Marker | Bedeutung |
|---|---|
| `SOL` / `RHC` | Chain des Paares |
| `SIM` | Simuliertes Paar — keine echten Marktdaten |
| `+AI` | Agent nutzt eine optionale externe Quelle |
| ▲ / ▼ | Richtung. Immer vorhanden, damit Farbe nie allein trägt |
| ⛔ | SENTINEL-Veto |
| Grün hinterlegte TP-Stufe | Diese Gewinnmitnahme ist erfolgt |
| Pulsierender Punkt | Agent arbeitet gerade |

---

## 4. Problem → wo du nachsiehst

| Symptom | Wo | Was es heißt |
|---|---|---|
| Es wird nichts gekauft | **Warum/Warum-nicht**, oberster Satz | Nennt die Hürde direkt |
| Immer dieselben Token | **DISCOVERY → `fresh launches`** | 0 bei Live-Daten = keine neuen Launches. `npm run check-sources` |
| Board altert | **DISCOVERY → `median age`** | Steigt dauerhaft = Discovery liefert nichts Frisches |
| Alles simuliert | **Statusleiste** | Der Grund steht im Klartext dort |
| Minus-Prozent ohne Trades | **Portfolio** | Sollte nicht mehr vorkommen — der Vergleich läuft gegen die Startbestände. Tritt es auf, stimmt etwas nicht |
| Terminal wirkt eingefroren | **Agenten-Desk**, Tick-Zähler | Zähler steht = Desk hängt. Zähler läuft = Anzeige hängt |
| Position wird nicht verkauft | **Offene Positionen** | SL/TP/Trail-Zustand stehen in der Zeile |
| Welche Trades liefen gut? | **Trade-Log → `TRADES`** | Ein Eintrag pro Round Trip, mit Ausgang und Grund |
| Trade sieht falsch aus | **Trade-Log → `FILLS`** | Zeigt, aus welchen Teilverkäufen er bestand |
| Einträge nur „APPROVAL REQUIRED" | Kopfzeile | Du bist in `MANUAL` |
| Tagesverlustlimit gerissen | **Warum/Warum-nicht** | Zwei Knöpfe dort: `RESUME` misst ab jetzt weiter, `RESET BOOK` startet den Lauf neu |

---

## 5. Was du steuern kannst

| Aktion | Wo | Wirkung |
|---|---|---|
| Autonomie umschalten | Kopfzeile | Sofort |
| Ticket freigeben/ablehnen | Freigabe-Queue | Sofort |
| Position schließen | `CLOSE` in der Positionszeile | Sofort, vollständig |
| Alles liquidieren | `KILL SWITCH` | Sofort, plus Sperre für neue Einstiege |
| Risiko ändern | `⚙ RISK` | Ab dem nächsten Tick |
| Limit-Sperre aufheben | `RESUME` im Warum/Warum-nicht-Panel | Sofort, Buch bleibt |
| Lauf neu starten | `↺ START A FRESH RUN` im Risk-Panel, oder `RESET BOOK` | Sofort, Buch wird geleert |
| Details zu einem Token | Zeile im Konsens-Board anklicken | Audit-Trail aller Agenten |

---

## 6. Vom Handy aus

```bash
npm run phone
```

Zeigt die LAN-Adresse und einen QR-Code. Handy und Rechner im selben WLAN, QR
scannen, fertig. Das Layout ist einspaltig ab Handybreite, alle Bedienelemente
sind erreichbar.

Was du unterwegs am ehesten sehen willst, steht ganz oben: Equity und
Änderung in der Kopfzeile, darunter der Agenten-Desk, darunter das
Warum/Warum-nicht-Panel mit dem Klartext-Satz.

**Sicherheitshinweis:** Der Server unterscheidet keine Nutzer. Wer im selben
Netz die Adresse kennt, kann den Kill-Switch drücken, Tickets freigeben und das
Buch zurücksetzen. Im Heimnetz bei Paper-Trading unkritisch — bei allem anderen
vorher nachdenken.

## 7. Wenn du nur eine Sache im Blick behältst

**Die Statusleiste unten.** Steht dort `simulated`, bedeutet kein einziges
Ergebnis auf dem Bildschirm irgendetwas über den echten Markt — egal wie gut
die Equity-Kurve aussieht.
