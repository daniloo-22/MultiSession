# MultiSession

Mini browser desktop a schede: ogni account vive in una sessione Electron isolata e persistente
(`persist:<id-account>`), così puoi tenere aperte più caselle webmail dello stesso provider
senza login/logout.

## Requisiti

- Node.js 22 o superiore (testato con Node 24)
- npm

## Installazione e avvio

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` avvia electron-vite: HMR sul renderer, rebuild e riavvio automatico per main e preload.

Altri comandi:

| Comando             | Cosa fa                                              |
| ------------------- | ---------------------------------------------------- |
| `npm run build`     | Compila main, preload e renderer in `out/`           |
| `npm run preview`   | Avvia l'app compilata                                |
| `npm run typecheck` | Controllo dei tipi su main/preload e renderer        |
| `npm run dist`      | Build + pacchetto con electron-builder in `dist/`    |

In sviluppo `F12` apre i DevTools della finestra o della webview che ha il focus, e il menu
contestuale delle pagine ha la voce "Ispeziona".

## Impacchettare con electron-builder

La configurazione è in [electron-builder.yml](electron-builder.yml): installer NSIS su Windows,
DMG su macOS, AppImage su Linux.

```bash
npm run dist
```

L'output finisce in `dist/`. Note:

- Si impacchetta per il sistema su cui si lancia il comando (`npm run dist:win` forza Windows).
  Per macOS serve un Mac, e per distribuirlo fuori dal tuo computer anche firma e notarizzazione.
- Per un'icona personalizzata metti `icon.ico` (Windows), `icon.icns` (macOS) o `icon.png`
  512×512 (Linux) nella cartella `build/`: electron-builder la prende da lì.
- Senza certificato di firma Windows SmartScreen mostrerà un avviso al primo avvio dell'installer.

## Dove finiscono i dati

Tutto in `app.getPath('userData')` (su Windows `%APPDATA%\MultiSession`):

| File                  | Contenuto                                                                 |
| --------------------- | ------------------------------------------------------------------------- |
| `environments.json`   | Ambienti: id, nome, colore                                                |
| `accounts.json`       | Account: id, nome, URL di partenza, colore, ambiente                      |
| `session-state.json`  | Schede aperte di tutti gli ambienti nell'ordine (id account, URL corrente, titolo), ambiente attivo e ultima scheda attiva di ogni ambiente |
| `preferences.json`    | Preferenze (tema chiaro/scuro)                                            |
| `window-state.json`   | Posizione, dimensione e stato massimizzato della finestra                 |
| `Partitions/<id>/`    | Cookie, localStorage, IndexedDB e cache di ogni account (gestiti da Electron) |

I file vengono scritti in modo atomico (file temporaneo + rename). Lo stato si salva con un
autosave debounced (~400 ms) a ogni cambio di URL, titolo, apertura, chiusura o riordino di
scheda, più un salvataggio sincrono alla chiusura della finestra: un crash o un kill del processo
perde al massimo l'ultimo istante. Se `session-state.json` manca, all'avvio si apre una scheda per
ogni account di `accounts.json`.

## Ambienti

Gli account sono raggruppati in **ambienti**, per esempio "ChatGPT" per gli account che usi
lì e "Scuola" per quelli della scuola. Il selettore è a sinistra nella barra delle schede:
mostra l'ambiente attivo e da lì si crea, rinomina, ricolora o elimina un ambiente.

- La barra mostra solo le schede dell'ambiente attivo; quelle degli altri restano aperte e
  loggate in sottofondo, quindi tornando a un ambiente ritrovi tutto com'era, sulla scheda dove
  l'avevi lasciato.
- Nuovi account e il menu "+" lavorano sull'ambiente attivo. Un account si sposta in un altro
  ambiente da "Modifica account", senza perdere login e dati.
- Eliminare un ambiente elimina anche i suoi account con le loro sessioni, previa conferma.
  L'ultimo ambiente non si può eliminare.
- Gli account creati prima degli ambienti finiscono in "Principale", che puoi rinominare.

## Collegare Claude (MCP)

MultiSession può essere letta e usata da Claude, in modo simile a Claude in Chrome: elencare
schede e account, leggere le pagine, fare screenshot, navigare, cliccare e scrivere. Agisce
anche sulle schede in background, senza cambiare quella che stai guardando.

Come funziona:

- Quando l'accesso è attivo (icona robot nella barra strumenti, attiva di default) l'app apre un
  piccolo server solo su `127.0.0.1`, su una porta casuale e con un token nuovo a ogni avvio.
  Porta e token finiscono in `agent-endpoint.json` nella cartella dati, che viene cancellato
  quando spegni l'accesso o chiudi l'app.
- `out/mcp/bridge.mjs` è il server MCP (stdio) che Claude avvia. Non contiene logica: legge quel
  file e inoltra le chiamate all'app. Se l'app è chiusa o l'accesso è spento, risponde con un
  errore chiaro.
- Mentre Claude agisce su una scheda, al posto del pallino colorato compare un robot.

Registrarlo in Claude Code (vale anche per la scheda Code dell'app desktop di Claude):

```bash
claude mcp add multisession --scope user -- node "C:\Users\Danil\Desktop\DanMultiSession\out\mcp\bridge.mjs"
```

Per la chat dell'app desktop di Claude aggiungi a `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "multisession": {
      "command": "node",
      "args": ["C:\\Users\\Danil\\Desktop\\DanMultiSession\\out\\mcp\\bridge.mjs"]
    }
  }
}
```

Con l'app installata via electron-builder il bridge sta in
`<cartella di installazione>\resources\mcp\bridge.mjs` (di default
`%LOCALAPPDATA%\Programs\MultiSession\resources\mcp\bridge.mjs`).

Tool disponibili: `list_accounts`, `list_tabs`, `open_tab`, `select_tab`, `close_tab`,
`navigate`, `get_page_text`, `read_page`, `find`, `click`, `type`, `press_key`, `scroll`,
`screenshot`, `javascript`, `save_file`, `list_downloads`. Lavorano su schede di qualsiasi
ambiente; `list_tabs` e `list_accounts` indicano l'ambiente e `open_tab` accetta `environment`
(o la forma "Ambiente/Account") quando lo stesso nome di account esiste in più ambienti.
`read_page` e `find` restituiscono
elementi con id `ref_N` da passare a `click`, `type`, `scroll` e `save_file`. Le coordinate degli
screenshot coincidono con quelle accettate da `click`.

- `save_file` scarica un file (URL http(s), `blob:`, `data:` o il `ref` di un'immagine/link)
  dentro la sessione dell'account, quindi con i suoi cookie e Cloudflare: funziona anche per i
  file che fuori dall'app danno 403. Scrive direttamente nel percorso indicato e a Claude
  restituisce solo percorso, dimensione e tipo, mai i byte.
- I download avviati dalle pagine (es. il pulsante "scarica" di un sito) finiscono subito in
  Download col nome vero, senza finestra "Salva con nome" e senza `.tmp` appesi; un avviso in
  basso a destra permette di aprire la cartella. `list_downloads` dice a Claude dove sono finiti.
- `navigate` aspetta che la nuova pagina sia davvero caricata, salta le richieste "Vuoi uscire
  dalla pagina?" (che in Electron annullavano la navigazione in silenzio) e, se una single-page
  app la ignora, la riprova come navigazione forzata. Se la pagina resta dov'era, lo dice. Quando
  sei tu a navigare, quella richiesta compare normalmente come in Chrome.
- MultiSession continua a disegnare e a far girare le schede anche quando la finestra è coperta
  da altre app o è in background (occlusione di Windows e throttling disattivati), così screenshot
  e input dell'agente funzionano mentre lavori altrove.
- `click`, `type` con `submit` e `press_key` controllano con una sonda nella pagina che l'input
  vero sia arrivato. Se non arriva (per esempio con la finestra minimizzata) ripiegano su eventi
  DOM e lo dicono nel risultato. `click` riporta anche quale elemento si trova sotto il punto
  cliccato, e `type` avvisa se dopo l'Invio il testo è ancora nel campo.
- `find` e `read_page` includono anche gli elementi dentro `aria-hidden` (le pagine lo usano
  quando è aperto un dialog) e quelli trasparenti che compaiono al passaggio del mouse.
- Se uno script di `javascript` va in errore, il tool riporta il messaggio reale della pagina.

Attenzione: con l'accesso attivo qualsiasi programma che gira col tuo utente Windows può leggere
il token e comandare le schede, incluse le caselle già loggate. Spegni l'accesso quando non ti
serve.

Per i test, `MULTISESSION_USER_DATA=<cartella>` fa usare all'app (e al bridge) una cartella dati
separata, così non si toccano account e sessioni reali.

## Scorciatoie

| Tasto                          | Azione                    |
| ------------------------------ | ------------------------- |
| `Ctrl+Tab` / `Ctrl+Shift+Tab`  | Scheda successiva / precedente |
| `Ctrl+PagGiù` / `Ctrl+PagSu`   | Scheda successiva / precedente |
| `Ctrl+W`                       | Chiudi scheda             |
| `Ctrl+R` / `F5`                | Ricarica                  |
| `Ctrl+L`                       | Vai alla barra indirizzi  |
| `Alt+←` / `Alt+→`              | Indietro / avanti         |
| Click centrale sulla scheda    | Chiudi scheda             |
| Click destro sulla scheda      | Menu della scheda         |

Su macOS `Cmd` al posto di `Ctrl`.

## Struttura

```
src/
  main/        processo principale: finestra, IPC, persistenza, popup → nuova scheda
  preload/     API esposta al renderer via contextBridge (window.api)
  shared/      tipi e canali IPC condivisi
  renderer/    React + Tailwind v4 + shadcn/ui
    src/store/       store Zustand unico (account, schede, preferenze) + autosave
    src/components/  TabBar, Toolbar, WebviewPane, dialog account
    src/styles/      globals.css con tutti i token di colore in @theme
```

## Note tecniche

- **User agent.** `app.userAgentFallback` è uno user agent Chrome reale costruito sulla versione
  di Chromium inclusa in Electron. Se un sito non funziona, il primo sospetto è lo user agent, non
  le partition.
- **Popup e `_blank`.** L'evento `new-window` delle webview è stato rimosso in Electron 22. Al suo
  posto il main process usa `setWindowOpenHandler` su ogni webview: nega la finestra e chiede al
  renderer di aprire una scheda nella stessa partition, accanto a quella di origine. I flussi che
  si appoggiano a `window.opener` (alcuni login in popup) quindi non ricevono la risposta: di solito
  il sito ripiega su un redirect nella stessa scheda.
- **Login Google.** Google blocca l'accesso dai browser incorporati a prescindere dallo user agent:
  Gmail potrebbe rifiutare il login. Altri provider (Outlook, Libero, Aruba, Zoho…) di norma vanno.
- **Login che restano dopo il riavvio.** Chromium non salva mai su disco i cookie di sessione
  (quelli senza scadenza) e li perde alla chiusura: è il motivo per cui Libero Mail chiedeva di
  nuovo il login, perché il suo login unico sta in un cookie del genere. Come Chrome con
  "Continua da dove avevi interrotto", [session-cookies.ts](src/main/session-cookies.ts) riscrive
  ogni cookie di sessione come persistente (30 giorni, rinnovati a ogni aggiornamento del sito) e
  forza il salvataggio su disco subito dopo login e logout, così sopravvive anche a un crash. Il
  logout del sito continua a funzionare, e "Svuota sessione" cancella tutto come prima. Il prezzo
  è che quei login restano sul disco del PC, come in Chrome con quell'opzione attiva.
- **Webview.** Ogni `<webview>` è creata a mano dentro un `useEffect`, con `partition` impostata
  prima di `src`, e non viene mai spostata nel DOM: riordinare le schede non ricarica le pagine.
- **Sicurezza.** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Il main
  rifiuta webview senza partition `persist:` o con URL non http(s) e toglie loro qualsiasi preload.
- **Tema.** Palette e varianti chiara/scura sono custom properties in `@theme` dentro
  [globals.css](src/renderer/src/styles/globals.css): per ritoccare i colori basta quel file.
"# MultiSession" 
