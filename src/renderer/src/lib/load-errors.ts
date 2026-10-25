// Chromium net error codes: https://source.chromium.org/chromium/chromium/src/+/main:net/base/net_error_list.h
const MESSAGES: Record<number, string> = {
  [-2]: 'Si è verificato un errore generico durante il caricamento.',
  [-7]: 'Il server ha impiegato troppo tempo a rispondere.',
  [-21]: 'La connessione di rete è cambiata durante il caricamento.',
  [-100]: 'Il server ha chiuso la connessione inaspettatamente.',
  [-101]: 'La connessione è stata reimpostata.',
  [-102]: 'Il server ha rifiutato la connessione.',
  [-105]: "Impossibile trovare l'indirizzo del server. Controlla che l'URL sia corretto.",
  [-106]: 'Sembra che tu sia offline. Controlla la connessione a Internet.',
  [-109]: 'Il server non è raggiungibile.',
  [-118]: 'La connessione è scaduta.',
  [-137]: 'Risoluzione del nome non riuscita.',
  [-200]: 'Il certificato di sicurezza del sito non è valido.',
  [-201]: 'Il certificato del sito è scaduto o non ancora valido.',
  [-202]: 'Il certificato del sito non è emesso da un ente riconosciuto.',
  [-310]: 'La pagina ti ha reindirizzato troppe volte.',
  [-324]: 'Il server non ha inviato alcun dato.'
}

export function describeLoadError(code: number, fallback: string): string {
  if (MESSAGES[code]) return MESSAGES[code]
  if (code <= -200 && code > -300) return 'Il sito ha un problema con il certificato di sicurezza.'
  return fallback ? `Impossibile caricare la pagina (${fallback}).` : 'Impossibile caricare la pagina.'
}
