# Cinese di Mia

App web installabile (PWA) per preparare **HSK 2, HSK 3 e HSKK elementare** — standard **HSK 2.0**
(liste ufficiali 2012: HSK 1 = 150, HSK 2 = 150, HSK 3 = 300 parole). Dopo il primo caricamento funziona
**del tutto offline**: audio e tratti dei caratteri vengono salvati sul dispositivo.

**Installazione su iPad:** apri il sito in Safari → Condividi → *Aggiungi alla schermata Home*.
Aprila una volta con la connessione e aspetta il messaggio «Pronta per l’uso offline».

## Cosa fa
- **Pagine del PDF** (una al giorno): le 300 parole HSK 3 divise come nelle 14 pagine del PDF hanzistroke.
  Per ogni pagina: flashcard (anche al contrario), quiz, scrittura con controllo dei tratti e foglio libero per scrivere a mano.
- **Sessione di oggi** (10–15 min): parole nuove + ripassi in ripetizione spaziata, scrittura, ascolto, riordino, orale.
  Il carico giornaliero si calcola da solo verso il 7 novembre (giorni di viaggio = metà carico).
- **Vocaboli senza pinyin** (tutti i livelli): il pinyin compare solo dopo la risposta. Ogni parola deve superare prove diverse
  (significato, tono, ascolto, significato→carattere) e conta la **velocità** di risposta.
- **Ascolto**: frasi, dialoghi HSK 2/3 e vero/falso nel formato d’esame (ogni registrazione due volte).
- **Scrittura**: carattere mancante dato il pinyin (con ordine dei tratti), riordino delle frasi.
- **HSKK**: ascolta e ripeti, ascolta e rispondi, domande aperte con timer — con registrazione e riascolto.

## Struttura
- `index.html`, `style.css`, `app.js`, `sw.js` — l’app (JavaScript semplice, nessuna build).
- `data/words.json` — vocaboli; `data/content.json` — frasi, dialoghi, HSKK; `data/media_index.json` — indice file.
- `audio/` — audio generato con voci neurali (edge-tts); `strokes/` — dati Hanzi Writer (licenza Arphic, vedi file).
- `tools/` — script per rigenerare tutto:
  ```
  python -X utf8 tools/build_words.py
  python -X utf8 tools/check_content.py data/content/*.jsonl
  python -X utf8 tools/gen_audio.py
  python -X utf8 tools/build_content.py
  ```
  Dopo ogni modifica al codice o ai dati, aumentare la versione `SHELL` in `sw.js`.

I progressi restano nel browser del dispositivo (Impostazioni → Esporta per una copia).
