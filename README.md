# 🎃 Geisterstunde – Anleitung für den Horror-Abend

Online-Horror-Quizduell für 4–12 Spieler in zufällig gelosten Zweierteams. Zwei Seiten mit je 8 Kategorien, jede Frage ist ein Team-Battle. Nach Seite 1 kommt das Backrooms-Minispiel.

## 1. Starten (auf dem PC des Hosts)

1. Das Spiel herunterladen: oben auf dieser Seite **„Code“ → „Download ZIP“** und die ZIP-Datei **entpacken**. Alternativ: `git clone https://github.com/luhescripts/Geisterstunde.git`. Der Speicherort ist egal, auch Leerzeichen oder Umlaute im Pfad sind kein Problem.
   Voraussetzung ist Windows 10/11. Node.js und cloudflared kann `start.bat` selbst installieren.
2. Doppelklick auf **`start.bat`**.
   - Fehlen **Node.js** oder **cloudflared** (für den Online-Link), fragt das Skript, ob es sie per winget installieren soll: einfach **J** drücken.
   - Beim ersten Start installiert das Skript die nötigen Pakete (`node_modules`) selbst, das braucht Internet.
3. Es öffnen sich die Fenster **„Geisterstunde Server“** und **„Geisterstunde Tunnel“** – beide offen lassen. Danach öffnet sich der Browser von selbst.
4. Klicke auf **„Neues Spiel hosten“**. Sobald der Tunnel steht (meist nach wenigen Sekunden), zeigt die Lobby automatisch den **Online-Einladungslink** (`https://….trycloudflare.com/?r=CODE`). Den kopierst du und schickst ihn in den Discord.

Der Online-Link steht außerdem im Server-Fenster („🌍 Online-Link für deine Freunde“). Er ist bei jedem Start neu.

**Was beim ersten Start passieren kann:**
- **Windows-SmartScreen** („Der Computer wurde durch Windows geschützt“): auf „Weitere Informationen“ und dann „Trotzdem ausführen“ klicken.
- **Firewall-Frage zu Node.js:** Du kannst „Abbrechen“ wählen. Der Online-Link funktioniert trotzdem.
- **„Port 3666 ist schon belegt“** im Server-Fenster: Das Spiel läuft bereits. Alte Fenster schließen und `start.bat` neu starten.
- **Ohne cloudflared** läuft das Spiel nur lokal bzw. im selben WLAN (die Adressen stehen im Server-Fenster).

Probier den Start auf dem Host-PC am besten schon vor dem Abend einmal aus.

## 2. Als Host spielen

- Der Host-Tab moderiert. Am besten teilst du ihn per Bildschirmfreigabe: Spielbrett, Auflösungen, die Live-Zeichnungen beim Montagsmaler und die Backrooms-Karte von oben.
- **Selbst mitspielen:** zweiten Tab mit dem Einladungslink öffnen und Namen eingeben.
- **🗒️ (oben rechts)** blendet unten einen Spickzettel mit der Lösung ein. Nicht anmachen, wenn du mitspielst oder deinen Bildschirm teilst.
- **💬 Team-Chats (unten rechts):** Du liest alle Team-Chats mit. Jedes Team lässt sich einzeln auf- und zuklappen, eine Zahl zeigt neue Nachrichten. Auch das nicht offen lassen, wenn du deinen Bildschirm teilst.
- **Zurückkommen, falls du rausfliegst:** `http://localhost:3666` öffnen und auf **„↩ Zurück zu deinem Spiel“** klicken, nicht auf „Neues Spiel hosten“. Aus einem anderen Browser oder von einem anderen PC aus öffnest du den **🔑 Spielleiter-Link**. Er steht im Server-Fenster, und in der Lobby kannst du ihn kopieren. Der Link funktioniert wie ein Schlüssel, also nicht weitergeben.

### Ablauf und Host-Leiste (unten)

| Phase | Knöpfe |
|---|---|
| Lobby | 🎲 Teams auslosen (die Leiste zeigt vorher, wie viele Teams es werden) |
| Teams | 🎲 Neu auslosen · ▶ Spiel starten (Spieler lassen sich per Auswahlfeld umsetzen) |
| Spielbrett | Das Team auf dem letzten Platz wählt das Feld, du kannst auch selbst klicken. ⏭ Seite beenden, falls die Zeit knapp wird |
| Intro | ⏩ Sofort starten · ✖ Abbrechen (das Feld bleibt offen) |
| Frage | +15 s · ⏹ Jetzt auflösen · ✖ Abbrechen |
| Auflösung | −50/+50 pro Team zum Korrigieren · ▶ Weiter |
| Backrooms | ▶ Starten · ⏹ Vorzeitig beenden · danach ▶ Weiter zu Seite 2 |
| Finale | 🔄 Neues Spiel (gleiche Spieler) |

**Teams:** Immer 2 Spieler pro Team, die Anzahl ergibt sich aus der Spielerzahl (8 Spieler → 4 Teams, 12 Spieler → 6 Teams). Bei ungerader Zahl spielt einer als **Einzelkämpfer** allein (9 Spieler → 4 Zweierteams + 1 Einzelteam):
- Er ist bei jeder Frage sein eigener Kapitän und tritt im Duell automatisch an.
- Beim Montagsmaler malt er nicht, sondern rät bei der Zeichnung eines anderen Teams mit. Das gilt auch, wenn in einem Zweierteam der Partner gerade offline ist.
- Den Team-Chat braucht er nicht, deshalb wird er bei ihm ausgeblendet.

**Nachzügler:** Wer nach dem Auslosen dazukommt, ergänzt das Einzelteam. Gibt es keins, bekommt er vor Spielbeginn ein eigenes Team, während des Spiels kommt er ins kleinste Team. Mit 🎲 Neu auslosen verteilst du alle neu.

**Kapitän:** Bei Abstimm-Fragen dürfen alle im Team mitmachen, ein Kapitän legt pro Frage fest. Die Rolle wechselt jede Frage. Ist der Kapitän offline, übernimmt automatisch jemand anderes. Läuft die Zeit ab, zählt der aktuelle Team-Entwurf bzw. die Mehrheit im Team. Bei der Hinweis-Jagd gibt es keinen Kapitän: Beide dürfen antworten, der erste Versuch zählt fürs Team.

## 3. Die Battle-Arten

| Art | Kategorien | So geht's | Punkte |
|---|---|---|---|
| 📍 Karten-Pin | Finde den Killer, Drehort-Jagd | Team-Nadel auf die Weltkarte setzen | Nächstes Team 100 %, dann 50/25 %; Volltreffer +100 |
| ⌨️ Tipp-Rennen | Emoji-Exorzismus, Internet-Grusel | Alle tippen beliebig oft, Tippfehler werden toleriert | Schnellstes richtiges Team 100 %, dann 75/50/25 % |
| ⏳ Sortieren | Grusel-Chronik | Per Ziehen oder ▲▼ in die richtige Reihenfolge bringen | Anteilig nach Richtigkeit; schnellstes fehlerfreies Team +25 % |
| 🔎 Hinweis-Jagd | Wer bin ich?, Pixel-Panik | Alle 7 s ein neuer Hinweis; das Team hat EINEN Versuch, wer zuerst abschickt, legt fest | 100/80/60/40/25 % je nach Hinweis |
| 🎨 Montagsmaler | Montagsmaler | Pro Team malt eine Person, die andere rät. Einzelkämpfer raten bei einem anderen Team mit | Schnellstes Team 100 %, dann 75/50/25 % |
| 🔗 Zuordnen | Fluch & Schwäche | Links antippen, dann rechts | Anteilig; schnellstes fehlerfreies Team +25 % |
| 🧩 Puzzle-Rennen | Zerstückelt | Teile tauschen (antippen, Ziel antippen) | Schnellstes Team 100 %, dann 75/50/25 %; Film erraten +25 % |
| 🎯 Schnellwahl | Wer stirbt zuerst?, Der Hochstapler | Abstimmen, der Kapitän legt fest | Richtig: 100/75/50/25 % nach Tempo |
| ⚖️ Schätz-Duell | Schätz-Gruft | Regler, Knöpfe oder Zahl eintippen | Nächstes Team 100 %, dann 50/25 %; Punktlandung +100 |
| 🤥 Lügendetektor | Lügendetektor | Wahr oder gelogen + Einsatz 25–100 % | Richtig: Einsatz gewonnen; falsch: halber Einsatz weg |
| 🔐 Code knacken | Entkomme dem Keller | Rätsel lösen, Zahlencode eintippen (falscher Code = 2,5 s Sperre); Tipp nach halber Zeit | Schnellstes Team 100 %, dann 75/50/25 % |
| ⚡ Höher oder Tiefer | Höher oder Tiefer | 5 Runden höher/tiefer | Jede richtige Runde = 20 % |

### 💡 Hinweise kaufen

- Jedes Team kann im ganzen Spiel **bis zu 3 Hinweise** kaufen, **je 200 Punkte**, höchstens einen pro Frage.
- Ein Spieler drückt während der Frage auf „💡 Hinweis kaufen“. Beim Spielleiter erscheint die Anfrage mit einem fertigen Vorschlag:
  - Anfangsbuchstaben
  - 50:50
  - Zahlenbereich
  - ein richtiges Paar
  - die letzte Code-Ziffer
  - beim Puzzle legt der Hinweis 3 Teile richtig
- Der Spielleiter kann den Text ändern und drückt **Freischalten** (kostet das Team 200) oder **Ablehnen** (kostet nichts).
- Bei Wahr/Gelogen und Höher/Tiefer gibt es keinen fertigen Vorschlag. Dort schreibt der Spielleiter selbst etwas oder lehnt ab.
- Der Hinweis erscheint nur beim eigenen Team.

### ⚔️ Duell-Feld

- Pro Seite ist **ein Feld heimlich das Duell-Feld**. Mit eingeschaltetem 🗒️-Spickzettel sieht der Spielleiter es an einem kleinen ⚔️.
- Das Team, das diese Frage gewinnt (die meisten Punkte, bei Gleichstand das schnellere), **fordert ein anderes Team heraus**. Bei nur zwei Teams ist der Gegner automatisch klar.
- Beide Teams schicken **je eine Person** als Kämpfer („🗡️ Ich trete an!“), ein Einzelkämpfer ist automatisch dabei. Die beiden beantworten eine **Schätzfrage**, wer näher dran ist, gewinnt.
- **Gewinnt der Herausforderer, stiehlt er 300 Punkte** vom Herausgeforderten. Gewinnt der Verteidiger oder ist es unentschieden, passiert nichts.
- Spielleiter-Knöpfe: Kämpfer zufällig bestimmen, +15 s, Jetzt auflösen, Duell überspringen.
- Die 8 Duellfragen stehen in `data/questions.json` unter `"duel"`.

**Backrooms:** 2:30 Minuten, WASD zum Laufen, Shift zum Rennen (macht Lärm!).

- **Umsehen** wie in jedem Shooter: einmal ins Bild klicken, dann dreht die Mausbewegung die Kamera, ohne eine Taste zu halten. ESC gibt die Maus wieder frei.
- Erlaubt der Browser das Einfangen nicht, folgt die Kamera trotzdem der Maus über dem Bild. Am linken oder rechten Rand dreht sie von selbst weiter.
- **Punkte:** Jeder Zettel bringt +25 fürs Team. Der Zettelkönig bekommt zusätzlich +50 pro Zettel.
- **Gefangen:** Wer gefangen wird, verliert einen Zettel und ist 6 s gelähmt. Bis 6 Spieler jagt 1 Monster, darüber 2.
- **Zettel gehen nicht aus:** Zu Beginn liegen 2 pro Spieler plus 8 herum, und es kommen ständig neue nach. Im Raum sind immer mindestens so viele, wie es Spieler gibt, plus 3.
- **Das Monster wird wütender:** Jeder gefundene Zettel macht es etwas schneller und wachsamer. Es sieht und hört weiter und erholt sich nach einem Fang schneller. Mit der Zeit legt es zusätzlich ein wenig zu.
- **Wut-Stufen:** Es gibt 5 Stufen, die oben rechts als „Monster-Wut“ angezeigt werden. Bei jeder neuen Stufe stößt das Monster einen Schrei aus, den alle hören.
- **Fairness:** Wer sprintet, ist immer schneller als das Monster. Sprinten macht aber Lärm.

## 4. Tipps für Discord

- Bei den Team-Battles hören im Sprachkanal alle mit. Absprachen gehören deshalb in den **💬 Team-Chat** im Spiel. Nur das eigene Team und der Spielleiter sehen ihn.
  - **Am PC** steht er als schmale Spalte rechts neben dem Spiel und verdeckt nichts. Mit „–“ lässt er sich einklappen.
  - **Am Handy** öffnet er sich über den Knopf unten rechts. Neue Nachrichten erscheinen kurz als Sprechblase.
- Wer lieber spricht, nutzt eigene Sprachkanäle pro Team. Bei Zweierteams reicht auch ein privater Anruf zu zweit.
- Fürs Quiz reicht auch das Handy, die Backrooms spielen sich am PC am besten.

## 5. Fragen anpassen

Alle 80 Fragen stehen in **`data/questions.json`**. Änderungen gelten für jedes **neu gehostete** Spiel, ohne Neustart. Die Werte 200–800 ergeben sich aus der Reihenfolge der 5 Fragen pro Kategorie. Felder je Typ:

- `map`: `prompt`, `lat`, `lng`, `label`, `radiusKm`, `info`
- `type`: `prompt`, optional `emoji`, `answers` (alle akzeptierten Schreibweisen)
- `sort`: `prompt`, `items` (`label`, `value`), `top`, `bottom`
- `clues`: `clues` (5 Hinweise), `answers`
- `draw`: `word`, `answers` (Synonyme)
- `match`: `prompt`, `pairs` (`left`, `right`)
- `puzzle`: `scene` (`halloween`, `es`, `freitag`, `ring`, `saw`), `grid` (3–5), `bonus`
- `choice`: `prompt`, `options`, `correct` (Index ab 0)
- `estimate`: `prompt`, `answer`, `unit`, `min`, `max`, optional `scale: "log"`, `tolerance`
- `bet`: `statement`, `correct` (true/false)
- `code`: `prompt`, `lines`, `code`, `hint`
- `hl`: `prompt`, `metric`, `items` (`label`, `value`, `display`)

## 6. Wenn etwas hakt

- **Spieler lädt neu oder fliegt raus:** Im selben Tab ist er automatisch wieder drin. In einem neuen Tab einfach den gleichen Namen eingeben, dann übernimmt er seinen alten Platz.
- **Spielleiter fliegt raus:** Die laufende Frage läuft noch zu Ende, danach wartet das Spiel. Die Spieler sehen nach ein paar Sekunden „Der Spielleiter ist gerade weg“. Zurück geht es wie in Abschnitt 2 beschrieben.
- **Server abgestürzt:** `start.bat` neu starten und den Host-Tab neu laden. Der Spielstand (Teams, Punkte, gespielte Felder) wird aus `saves/` wiederhergestellt. Eine laufende Frage wird abgebrochen und bleibt offen.
- **Kein Ton oder zu laut:** einmal irgendwo klicken (Browser-Regel). Ein Klick auf das 🔊-Symbol oben rechts öffnet einen Regler für leiser/lauter und einen Stumm-Knopf. Die Einstellung merkt sich der Browser.
- **Karte lädt nicht:** Die Karte braucht Internet (OpenStreetMap).
- **Neue Runde:** Im Finale 🔄 „Neues Spiel“, oder auf der Startseite einen neuen Raum hosten.

## Technik

Node.js-Server (`server.js`, `lib/`) mit socket.io und Browser-Client (`public/`).
Die Sounds stammen aus den Sonniss-GDC-2026-Bundles (lizenzfrei) und von Kenney (CC0); `node dev/build-sounds.js` baut sie neu.
Testseiten: `dev/br-harness.js` (Backrooms allein) und `dev/assets-test.html` (Sounds und Puzzlebilder).
Kürzere Backrooms-Runde zum Ausprobieren: vor dem Start `set GS_BR_SECONDS=60` (Standard sind 150 Sekunden).
