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

Bench, 24 Kohorten, ~170 Trades pro Variante. Ausgangspunkt ist der Zustand
vom Übernacht-Lauf.

| | vorher | + frühe Stufe | + Drain-Trend | + Late-Filter |
|---|---|---|---|---|
| Gewinnfaktor | 2.83 | **3.02** | 2.77 | 2.16 |
| Einbrüche < −50 % | 20 | **11** | 21 | 19 |
| Rückgabe vom Hoch | 79 pp | **74 pp** | 79 pp | 69 pp |
| Max. Drawdown | 16.7 % | **16.0 %** | 16.9 % | 19.5 % |
| Rendite | +25.5 % | +23.0 % | +24.9 % | +15.6 % |

**Eine von vier Ideen hat die Prüfung bestanden.**

### Übernommen: erste Take-Profit-Stufe bei +25 %

`takeProfitLadder: [50, 150, 400]` → `[25, 90, 300]`.

Der Grund ist nicht Gewinnmitnahme, sondern Schadensbegrenzung. Ein
Liquiditätsabzug ist **eine** Transaktion — der nächste Kurs, den das Desk
sieht, ist schon der Boden. Kein Preis-Stop kann dazwischen auslösen. Das
Einzige, was eine offene Position noch tun kann, ist **kleiner zu sein**,
wenn es passiert. 40 % bei +25 % verkauft macht aus einem −97 %-Trade einen
−49 %-Trade. Einbrüche unter −50 % gingen um 45 % zurück.

Die Größe der ersten Stufe wurde ebenfalls durchgemessen (30/40/50/60 %):
mehr als 40 % senkt die Rendite monoton, ohne weitere Einbrüche zu verhindern.

### Verworfen: Late-Entry-Filter

Die Idee: ein Paar, das schon +1187 % in einer Stunde gemacht hat, ist ein
später Einstieg in eine abgeschlossene Bewegung, kein starker Trend.

Das Bench sagt klar nein. Bei jeder getesteten Schwelle (80/150/300/600 %)
verschlechtert sich alles monoton, je enger gefiltert wird — und **kein
einziger Einbruch** wird verhindert. Wie weit etwas gelaufen ist, sagt
nichts darüber, ob gleich der Pool gezogen wird.

Der Regler bleibt (`maxEntryRunPct`), steht aber auf praktisch aus. Ein
echtes Tape darf die Frage neu stellen — mit Belegen statt mit Intuition.

### Verworfen: entsättigte Trendkurve

Die alte QUANT-Kurve (`√trend × 7`, gedeckelt bei 34) erreicht ihr Maximum
schon bei etwa +24 % Gesamtbewegung. Ein Paar mit +50 % und eines mit
+1187 % bekommen **dieselbe Punktzahl**. Das sieht nach vernichteter
Information aus, und eine logarithmische Kurve war die naheliegende Reparatur.

Gemessen kostete sie ein Viertel aller Einstiege und ein Fünftel des
Gewinnfaktors — bei exakt gleich vielen Einbrüchen. Zurückgenommen. Die
Beobachtung steht als Kommentar im Code, damit sie nicht zum dritten Mal
neu entdeckt wird.

### Behalten als Notnetz: Drain-Trend

`liquidityTrendExitPct: 40` — 40 % des Pools verschwinden in sechs Minuten,
während der Kurs hält. Auf dem Bench löst diese Schwelle **nie** aus und
kostet exakt nichts; niedrigere Schwellen lösen oft aus und kosten etwas.

Es ist kein Edge, sondern eine Absicherung gegen eine Form, die das Desk
vorher **überhaupt nicht sehen konnte** — jeder bisherige Rug-Test war eine
Momentaufnahme. Dass der Pool sich leert, während die Position grün aussieht,
steht in keiner einzelnen Momentaufnahme. Es braucht zwei und eine Subtraktion.
Genau die frühere Momentaufnahme hat das Desk nie aufgehoben; jetzt schon
(`PricePoint.l`).

---

## 6. Was das Bench nicht kann

- **Es sagt nichts über Rendite.** Die Mischung der Archetypen (5 Früh-Rugs,
  2 Spät-Rugs, 3 Distributionen, 4 Bleeds, 4 Chops, 2 Runner) ist gesetzt,
  nicht gemessen. Sie stammt aus dem Übernacht-Lauf, aber sie bleibt eine
  Annahme. Andere Mischung, andere Zahlen.
- **Es kann Rug-Vorhersage nicht prüfen.** Im Bench ist der Zeitpunkt des
  Abzugs unabhängig von der Pumpgröße — weil ich es so gebaut habe. Ob das
  in Wirklichkeit auch so ist, kann nur ein Tape sagen. Das ist genau der
  Punkt, an dem der Late-Entry-Filter hängt.
- **Die Trefferquote ist zu gut.** Bench ~60 %, live 29 %. Nur *relative*
  Vergleiche zwischen Varianten zählen, nie die absolute Zahl.

Jeder Report druckt diese Warnung selbst mit aus, zusammen mit der Zahl der
Trades im kleinsten Lauf.

---

## 7. Die nächste Frage

Ein aufgezeichneter Lauf über eine Nacht. Damit lässt sich beantworten, was
das Bench prinzipiell nicht kann:

1. **Sagt die Pool-Entwicklung vor dem Rug irgendetwas voraus?**
   Dafür gibt es jetzt `npm run backtest -- --tape … --rugs`. Es sucht die
   Paare, die wirklich zusammengebrochen sind (≥70 % in zwei Frames), schaut
   sich an, was ihr Pool in den Minuten davor tat, und vergleicht das mit
   allen Paaren, die nicht zusammengebrochen sind.

   Entscheidend ist nicht „leeren sich Pools vor einem Rug" — manche tun das
   zufällig. Entscheidend ist das **Paar aus Trefferrate und Fehlalarmrate**:
   eine Regel, die 90 % der Rugs fängt und dafür die Hälfte des Marktes
   aussperrt, ist schlechter als gar keine Regel, und nur die zweite Zahl
   sagt das. Die Ausgabe stellt beide nebeneinander.

   Auf dem Prüfstand meldet das Werkzeug korrekt **kein** Signal — dort wird
   der Pool bis zuletzt gefüllt, weil ich ihn so gebaut habe. Das ist der
   Funktionsnachweis: es findet nichts, wo nichts ist.
2. Sind Paare, die schon 10x gelaufen sind, häufiger Rugs — oder nicht?
3. Welcher Agent trägt wirklich zum Ergebnis bei? Die Konsensgewichte
   (0.5 / 0.3 / 0.2) sind geschätzt und noch nie gemessen worden.
