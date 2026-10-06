import type { FastifyInstance } from 'fastify';

function page(title: string, body: string): string {
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} – PWA Preview</title><style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:760px;margin:48px auto;padding:0 20px;color:#171717}
main{border:1px solid #ddd;border-radius:16px;padding:28px}h1{margin-top:0}h2{margin-top:28px}p,li{line-height:1.55}
nav{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:24px}a{color:#175cd3}.muted{color:#666}
@media(max-width:600px){body{margin:20px auto;padding:0 14px}main{padding:20px}}
</style></head><body><nav><a href="/">PWA Preview</a><a href="/about">Om tjänsten</a><a href="/support">Support</a><a href="/privacy">Integritet</a><a href="/terms">Villkor</a></nav><main>${body}</main></body></html>`;
}

export async function registerPublicInfo(app: FastifyInstance): Promise<void> {
  const send = (reply: any, title: string, body: string) =>
    reply.type('text/html; charset=utf-8').header('cache-control','public, max-age=300').send(page(title, body));

  app.get('/about', async (_request, reply) => send(reply, 'Om tjänsten', `
<h1>PWA Preview</h1>
<p>PWA Preview publicerar redan byggda statiska webbappar och PWAs som tillfälliga HTTPS-previewmiljöer.</p>
<h2>Så fungerar det</h2><ul>
<li>En användare anger en HTTPS-URL till ett stödd ZIP- eller tar.gz-arkiv.</li>
<li>Tjänsten packar upp statiska filer utan att köra applikationens byggkod.</li>
<li>Previewen får en tillfällig HTTPS-adress och en begränsad livslängd.</li>
<li>Användaren kan uppdatera, förlänga eller radera sina egna previews.</li>
</ul>
<p>Utvecklare: Erland Lindmark. <a href="https://github.com/erland/pwa-preview">Källkod på GitHub</a>.</p>`));

  app.get('/support', async (_request, reply) => send(reply, 'Support', `
<h1>Support för PWA Preview</h1>
<p>Felrapporter, frågor och förbättringsförslag kan lämnas i projektets publika GitHub Issues.</p>
<p><a href="https://github.com/erland/pwa-preview/issues">Öppna GitHub Issues</a></p>
<p>Publicera inte OAuth-tokens, bearer tokens, signerade artifact-länkar eller andra hemligheter i ett issue.</p>`));

  app.get('/privacy', async (_request, reply) => send(reply, 'Integritet', `
<h1>Integritetspolicy för PWA Preview</h1>
<p>PWA Preview behandlar de uppgifter som behövs för inloggning, preview-hantering och säker drift.</p>
<h2>Uppgifter som behandlas</h2><ul>
<li>GitHub-identitet och uppgifter som behövs för autentisering och tillåten åtkomst.</li>
<li>Preview-metadata, tillfälliga statiska filer och käll-URL:er som användaren anger.</li>
<li>MCP/OAuth-tokenmetadata och tekniska säkerhets- och driftloggar.</li>
</ul>
<h2>Användning och lagring</h2>
<p>Uppgifterna används för att skapa, visa, uppdatera, förlänga och radera previews. Previews har begränsad livslängd och rensas automatiskt enligt tjänstens konfiguration.</p>
<h2>Tredje parter</h2>
<p>GitHub används för autentisering. PWA Preview säljer inte personuppgifter och använder inte uppladdat innehåll för annonsering.</p>
<p>Frågor om databehandling kan tas via <a href="/support">support-sidan</a>.</p>
<p class="muted">Senast uppdaterad: 6 oktober 2026.</p>`));

  app.get('/terms', async (_request, reply) => send(reply, 'Villkor', `
<h1>Användarvillkor för PWA Preview</h1>
<p>Genom att använda PWA Preview ansvarar du för att du har rätt att publicera det material du använder med tjänsten.</p>
<h2>Ditt ansvar</h2><ul>
<li>Använd endast statiska filer och externa resurser som du har behörighet till.</li>
<li>Skicka inte hemligheter i preview-arkiv.</li>
<li>Använd inte tjänsten för olaglig verksamhet eller för att kringgå åtkomstkontroller.</li>
</ul>
<h2>Temporära resurser</h2>
<p>Previews kan tas bort automatiskt när deras livslängd löper ut. Tjänsten kan ändras eller vara tillfälligt otillgänglig vid underhåll eller tekniska problem.</p>
<h2>Support</h2><p>Support finns på <a href="/support">support-sidan</a>.</p>
<p class="muted">Senast uppdaterad: 6 oktober 2026.</p>`));
}
