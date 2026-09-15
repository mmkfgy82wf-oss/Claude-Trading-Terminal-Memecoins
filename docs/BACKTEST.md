# Backtest — Regeln messen statt glauben

Wie das Desk gegen aufgezeichnete Marktdaten und gegen ein Prüfstands-Bench
laufen kann, was dabei herausgekommen ist, und wo die Grenzen liegen.

---

## 1. Warum es das gibt

Bis hierhin wurden drei Änderungen an der Handelslogik vorgenommen und drei
**verschiedene** Live-Läufe miteinander verglichen — andere Token, andere
Stunden, andere Marktlage. Jeder dieser Vergleiche war verunreinigt. Bei
12 bis 28 Trades liegt jede Bewegung im Rauschen.

Ein Backtest beantwortet die Frage, die ein Live-Lauf nicht beantworten kann:
**dieselben Daten, zwei Regelsätze.**

---

## 2. Zwei Datenquellen, die man nicht verwechseln darf

| | **Tape** | **Bench** |
|---|---|---|
| Was es ist | Was das Desk live gesehen hat, mitgeschrieben | Formen, die wir absichtlich gebaut haben |
| Beweist etwas über | den Markt | den Code |
| Enthält Liquidität | ja, echt | ja, konstruiert |
| Verfügbar | erst nach einem aufgezeichneten Lauf | sofort |

Beides läuft durch **dieselben** Agenten, dieselbe Wallet, dieselbe
Pipeline (`runDeskCycle`). Es gibt keine zweite Implementierung des Desks —
das war Absicht, denn eine Replay-Kopie der Pipeline würde beim ersten
Umbau still die alte Reihenfolge weiter validieren.

### Warum kein Abruf historischer Kurse?

Weil die Zahl, auf die es ankommt, dort nicht existiert. GeckoTerminal und
DexScreener liefern historische OHLCV-Kerzen — Preis und Volumen. **Pooltiefe,
Orderflow und FDV gibt es historisch nirgends kostenlos.** Genau die drei
entscheiden aber bei einem Memecoin über Leben und Tod. Also schreibt das
Terminal sie selbst mit, solange es ohnehin hinschaut.

---

## 3. Ein Tape aufzeichnen

```bash
MARKET_RECORD=./tapes/nacht.jsonl npm run dev
```

Eine Zeile JSON pro Frame, angehängt, Standard alle 15 s
(`MARKET_RECORD_SAMPLE_MS`). Kurspreis-Historie wird **nicht** gespeichert —
sie ist abgeleitet, und der Replay baut sie exakt so wieder auf wie der
Live-Feed. Ein abgeschnittener letzter Satz (Prozess getötet) kostet genau
diese eine Zeile.

Größe, nachgerechnet statt geschätzt (ein Token belegt 619 Bytes):

| verfolgte Paare | alle 15 s | alle 30 s | alle 60 s |
|---|---|---|---|
| 120 | 18 MB/h | 9 MB/h | 4 MB/h |
| 240 | 36 MB/h | 18 MB/h | 9 MB/h |

**Empfohlen ist `MARKET_RECORD_SAMPLE_MS=30000`.** Der Trend-Test braucht
mindestens 6 Messpunkte im 6-Minuten-Fenster; bei 30 s sind es 12, bei 60 s
genau 6 — also zu knapp. 15 s bringt keine zusätzliche Information und
verdoppelt nur die Datei. Ein Rug selbst ist ohnehin in keinem Takt zu
erwischen: er ist eine einzige Transaktion.

Das Tape wird angehängt. Ein Neustart mit anderer Taktrate verliert nichts;
der Replay liest die Frames einfach in der Reihenfolge, in der sie stehen.

Ausgeschaltet, solange `MARKET_RECORD` nicht gesetzt ist. Ein Schreibfehler
schaltet den Rekorder ab und sonst nichts — das Desk handelt weiter.

## 4. Laufen lassen

```bash
npm run backtest                              # Bench, Basiskonfiguration
npm run backtest -- --tape ./tapes/nacht.jsonl
npm run backtest -- --compare --cohorts 24    # Varianten gegeneinander
npm run backtest -- --sweep stopLossPct=10,15,25,40
npm run backtest -- --tape ./tapes/nacht.jsonl --rugs   # sagt der Pool den Rug voraus?
```

`--cohorts N` würfelt N unabhängige Bench-Kohorten und poolt die Trades.
Eine einzelne Zwei-Stunden-Kohorte liefert 8–9 Trades; damit lässt sich
nichts unterscheiden. Bei einem Tape hat `--cohorts` keine Wirkung: der
eine Lauf ist der eine Lauf.

Alles ist deterministisch. Die Uhr kommt aus den Frame-Zeitstempeln, der
Slippage-Jitter aus einem gesetzten Seed. Zweimal derselbe Tape mit
derselben Konfiguration ergibt dieselben Trades auf den Cent.

---

## 5. Was gemessen wurde

### Erst der Prüfstand — und warum er in die Irre führte

24 Kohorten, ~170 Trades je Variante. Ergebnis damals: die frühe
Take-Profit-Stufe gewinnt klar (Einbrüche unter −50 % von 20 auf 11,
Gewinnfaktor 2,83 → 3,02), der Late-Entry-Filter verliert klar (2,16).
Also wurde die frühe Stufe übernommen und der Filter verworfen.

### Dann 13,9 Stunden echter Markt

1021 Frames, 1087 Paare, aufgezeichnet in einer Nacht.

| | Basis | frühe Stufe | Drain −20 % | Late-Filter |
|---|---|---|---|---|
| Rendite | **+1,2 %** | −31,3 % | −17,5 % | −5,8 % |
| Gewinnfaktor | **1,04** | 0,78 | 0,91 | 0,97 |
| Trades | 93 (42W/51L) | 100 (40W/60L) | 100 (47W/53L) | 59 (26W/33L) |
| Trefferquote | 45 % | 40 % | 47 % | 44 % |
| Einbrüche < −50 % | 12 | **15** | 13 | **10** |
| Rückgabe vom Hoch | 155 pp | **67 pp** | 142 pp | 54 pp |
| Max. Drawdown | 30,7 % | 50,7 % | 40,9 % | **29,0 %** |

**Der Prüfstand hat sich bei beiden Urteilen geirrt, und zwar in beide
Richtungen.** Die frühe Stufe war auf echten Daten die schlechteste Variante.
Der Late-Entry-Filter, den der Prüfstand am härtesten verworfen hatte, kam auf
Platz zwei und hatte den niedrigsten Drawdown von allen.

Das ist kein Detail, sondern das wichtigste Ergebnis dieser Seite: **eine
selbstgebaute Mischung von Marktformen sagt nichts darüber, was am Markt
passiert.** Der Prüfstand taugt für Regressionstests einer einzelnen Regel
(„hätte diese Logik hier herausgefunden?") und für nichts sonst.

### Warum die frühe Stufe verlor

Zwei Gründe, beide nachvollziehbar:

1. **Sie hat zwei Dinge gleichzeitig geändert.** Die Übergabe vom engen an
   den weiten Trail hing an der ersten Leitersprosse. Ein Trail von X % kann
   erst über dem Einstieg schließen, wenn das Hoch X/(1−X) überschritten hat —
   bei 30 % also +43 %. Mit der Sprosse bei +50 % lag das Schutzfenster bei
   [14 %, 50 %); mit der Sprosse bei +25 % schrumpfte es auf [14 %, 25 %), und
   jede Position, die zwischen +25 % und +43 % gipfelte, fiel an eine Regel,
   die sie rechnerisch nicht schützen konnte. **Das ist inzwischen behoben:**
   die Übergabe folgt jetzt dem Trail selbst, nicht der Leiter.

2. **Freigewordenes Kapital kauft mehr Rugs.** 93 → 100 Trades. Der kleinere
   Verlust je Rug hat die zusätzlichen nicht bezahlt — deshalb stiegen die
   Einbrüche unter −50 % von 12 auf 15, obwohl genau das Gegenteil das Ziel war.

Die Leiter steht wieder auf `[50, 150, 400]`. Die Idee ist damit nicht
widerlegt, nur ihre erste Umsetzung: mit entkoppelter Übergabe ist sie als
Variante `early rung` erneut messbar.

### Sagt der Pool den Rug voraus? — Nein

150 Einbrüche ≥ 70 % auf dem Tape, 104 davon mit genug Pool-Historie davor.

| | Median Pooländerung in den 6 Min davor |
|---|---|
| vor einem Einbruch | **+2,4 %** |
| bei Überlebenden | +0,0 % |

Der Pool wird vor einem Rug **gefüllt**, nicht geleert. Die beste Schwelle
(−15 %) fängt 16 % der Einbrüche — 84 % treffen also weiterhin voll — bei 4 %
Fehlalarmen, und diese 4 % sind eine Untergrenze, weil die Auswertung einen
Messpunkt je Paar zählt, die Regel live aber bei jedem Tick greift.

Damit ist die Frage beantwortet, die den ganzen Aufzeichnungsaufwand
gerechtfertigt hat, und die Antwort ist unbequem: **einen Rug kann man nicht
kommen sehen.** Er ist eine Transaktion, und die Liquidität geht bis zur
letzten Sekunde hinein. Was bleibt, ist die Einstiegsseite — nicht früher
aussteigen, sondern seltener hineingehen. Genau dorthin zeigt auch der
Late-Entry-Filter mit seinen 59 statt 93 Trades.

## 6. Was das Bench nicht kann

Nach dem Tape ist diese Liste nicht mehr theoretisch — jeder Punkt ist
eingetreten.

- **Es sagt nichts über Rendite.** Die Mischung der Archetypen ist gesetzt,
  nicht gemessen. Sie stammte aus dem Übernacht-Lauf und war trotzdem falsch
  genug, um zwei Urteile umzudrehen.
- **Es kann Rug-Vorhersage nicht prüfen**, weil ich den Abzugszeitpunkt
  unabhängig von allem anderen platziert habe. Dass es dort kein Signal
  meldet, war ein Funktionsnachweis, kein Befund — der Befund kam vom Tape,
  und er lautete zufällig genauso.
- **Die Trefferquote ist zu gut.** Bench ~60 %, Tape 45 %, live 38–41 %.

Wofür er weiterhin taugt: als Regressionstest für eine einzelne Regel, ohne
Netz und ohne Warten. „Hätte dieser Ausstieg diese Form erwischt?" beantwortet
er sofort und zuverlässig. „Verdient diese Regel Geld?" beantwortet er nicht,
und man sollte ihn nicht fragen.

## 7. Was als Nächstes zu messen ist

`npm run backtest -- --tape … --compare` fährt inzwischen diese fünf:

| Variante | Frage dahinter |
|---|---|
| `baseline` | der ausgelieferte Stand, der als einziger grün war |
| `early rung` | trägt die frühe Stufe, jetzt ohne die Trail-Verkopplung? |
| `late 150` / `late 300` | der Filter, den der Prüfstand zu Unrecht verworfen hat |
| `drain -15` | die Schwelle, die die Rug-Auswertung nominiert hat |

Zwei Fragen bleiben offen, und beide sind am Tape auswertbar statt nur
diskutierbar:

1. **Alterfenster und SCOUT-Ranking.** Medianalter der Watchlist 1 h, im Board
   stehen trotzdem regelmäßig deutlich ältere Paare. Ein tiefer Pool schlägt
   offenbar die Frische.
2. **Agenten-Attribution.** Die Konsens-Gewichte 0.5 / 0.3 / 0.2 sind
   geschätzt und noch nie gemessen worden. Am Tape ist das eine Auswertung,
   kein Umbau.

Und eine dritte, die das Tape gerade neu aufgeworfen hat: der Median der
Pooländerung liegt vor einem Einbruch bei +2,4 %, bei Überlebenden bei 0,0 %.
Ein Unterschied besteht also — nur nicht dort, wo eine feste Schwelle ihn
greifen könnte. Er wäre **relativ zum eigenen Verlauf** des Paares zu messen,
nicht absolut. Das ist noch keine Regel, aber es ist die einzige Spur, die
das Tape auf der Rug-Seite hinterlassen hat.
