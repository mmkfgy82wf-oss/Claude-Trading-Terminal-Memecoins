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
npm run backtest -- --tape ./tapes/nacht.jsonl --rugs      # sagt der Pool den Rug voraus?
npm run backtest -- --tape ./tapes/nacht.jsonl --entries   # was trennt Gewinner am Einstieg?
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

## 7. Die Ausstiegsseite ist leer

Zweiter Durchlauf über dasselbe Tape, diesmal mit entkoppelter Trail-Übergabe:

| | Basis | frühe Stufe | late 150 | late 300 | Drain −15 |
|---|---|---|---|---|---|
| Rendite | **+1,4 %** | −10,6 % | −6,5 % | −13,7 % | −8,9 % |
| Gewinnfaktor | **1,04** | 0,96 | 0,97 | 0,90 | 0,97 |
| Trades | 93 | 103 | 59 | 68 | 108 |
| Einbrüche < −50 % | 12 | 14 | **10** | 13 | 13 |
| Rückgabe vom Hoch | 155 pp | 63 pp | **54 pp** | 61 pp | 132 pp |
| Max. Drawdown | 30,7 % | 37,8 % | **29,0 %** | 36,4 % | 36,5 % |

Die Entkopplung hat die frühe Stufe von −31,3 % auf −10,6 % gehoben, der
Gewinnfaktor von 0,78 auf 0,96 — die Diagnose stimmte also. Sie bleibt
trotzdem hinter der Basis.

**Und die Basis selbst ist nicht signifikant.** 93 Trades, Erwartungswert
$1,03 je Trade, Standardfehler ±$5,87. Das 95-%-Intervall über den ganzen
Lauf reicht von **−$973 bis +$1.166**; beobachtet wurden +$96. Der
schlechteste Einzeltrade allein macht $231 aus, also mehr als das Doppelte
des gesamten Nettogewinns.

Damit lautet das Ergebnis nicht „die Basis gewinnt", sondern:

> Keine der fünf Konfigurationen ist von der Nulllinie zu unterscheiden, und
> die Abstände zwischen ihnen sind kleiner als ein einzelner Trade.

Drei Runden Ausstiegs-Tuning, dreimal null oder negativ. Das ist selbst eine
Antwort: **sobald eine Memecoin-Position offen ist, gibt es kaum noch etwas zu
entscheiden.** Der Rug lässt sich nicht kommen sehen (Abschnitt 5), der Trail
kann unterhalb seiner eigenen Schwelle nichts schützen, und jede Regel, die
früher aussteigt, schneidet die Runner ab, die die Verlierer bezahlen müssen.

Zwei Zahlen aus der Tabelle sagen das am deutlichsten: Die Basis hat mit
155 pp die **mit Abstand größte Rückgabe vom Hoch** — und ist die einzige
Variante im Plus. Jede Variante, die diese Rückgabe verkleinert (54–63 pp),
verliert Geld. „Weniger zurückgeben" ist keine Zielgröße, sondern ein
Nebenprodukt davon, Gewinner zu früh zu schließen.

## 8. Was als Nächstes zu messen ist

Die Einstiegsregeln sind aus dem Bauch geschrieben und noch nie gegen ein
Ergebnis geprüft worden. Dafür gibt es jetzt:

```bash
npm run backtest -- --tape ./tapes/nacht.jsonl --entries
```

Für jeden Trade wird festgehalten, was das Desk im Moment des Einstiegs sehen
konnte — Alter, Pooltiefe, FDV-Verhältnis, Umsatz, Lauf über 5 m / 1 h / 24 h,
Kaufanteil, Volumenschub, Konsensscore **und die Einzelnote jedes Agenten**.
Danach wird je Merkmal verglichen, wie die obere gegen die untere Hälfte
abgeschnitten hat. Das beantwortet nebenbei die Attributionsfrage, die seit
dem ersten Tag offen ist: ob die Gewichte 0.5 / 0.3 / 0.2 irgendetwas treffen.

Es schlägt **keine Regel vor**. Bei rund hundert Trades und vierzehn Merkmalen
sieht immer etwas nach Signal aus, und die Sortierung nach Abstand zeigt per
Konstruktion das größte Rauschen zuerst. Ein Abstand zählt erst, wenn er auf
einem zweiten, unabhängigen Tape wieder auftaucht — deshalb lohnt sich eine
zweite Nacht.

Eine Probe aufs Exempel steckt schon in den Tests: ein **konstantes** Merkmal
erzeugte anfangs einen Abstand von 70 Punkten, rein aus der Reihenfolge der
Trades, weil gleiche Werte beim Sortieren in Eingabereihenfolge stehen bleiben.
Gleichstände gehören jetzt zu keiner Hälfte.

Ohne neuen Code beantwortbar ist außerdem, ob der Konsensscore überhaupt
rangiert:

```bash
npm run backtest -- --tape ./tapes/nacht.jsonl --sweep minConsensusScore=40,55,70,85
```

Steigt die Auszahlung mit der Schwelle, ordnet der Score. Bleibt sie flach,
ist er Dekoration.
