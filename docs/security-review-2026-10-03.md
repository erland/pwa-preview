# Säkerhetsgranskning – pwa-preview

**Datum:** 2026-10-03  
**Gren som granskats:** `main` efter merge av PR #3–#9  
**Granskningsläge:** Standard  
**Status:** Avslutande omgranskning efter säkerhetshärdning

## Sammanfattning

Den ursprungliga granskningen identifierade inga verifierade kritiska autentiserings-, IDOR-, path traversal- eller SSRF-bypassproblem. De tydligaste riskerna låg i resursförbrukning, livslängd för åtkomst efter allowlist-revokering, supply-chain-härdning och isolering mellan kontrollplanet och godtyckliga preview-appar.

Efter PR #3–#9 bedöms de ursprungliga verifierade säkerhetsfynden vara åtgärdade eller reducerade till accepterad residualrisk för den dokumenterade v1-arkitekturen.

**Aktuell helhetsbedömning:** inga kända verifierade kritiska eller höga applikationsfynd kvar från denna granskning.

Detta är inte ett påstående om att systemet är “säkert” i absolut mening. Nya beroenden, nya funktioner, ändrad driftsarkitektur eller horisontell skalning kräver ny bedömning.

## Scope

Granskningen omfattade huvudsakligen:

- GitHub OAuth och browser-sessioner
- MCP Bearer-tokenautentisering
- allowlist och revokering
- owner-scopad åtkomst till previews
- host-routing mellan kontrollplan och preview-plan
- ZIP/tar.gz-import
- path traversal och specialfiler
- URL-import och SSRF-skydd
- statisk preview-serving
- create/update/delete-livscykel
- resursgränser och DoS-yta
- persistent lagringsförbrukning
- CI/release supply chain
- Docker-runtime och produktionskonfiguration

## System- och trust-boundary-bild

Kontrollplanet hanterar UI, REST, auth och MCP. Preview-planet exponerar användaruppladdad statisk kod på separata hostnamn.

Preview-innehåll betraktas som opålitligt. Det exekveras i användarens browser men inte som server-side buildkod.

Produktion använder separata registrerbara domäner:

- kontrollplan: `isaksson.info`
- previews: `apphome.one`

Applikationen validerar nu detta vid startup.

## Fynd och åtgärdsstatus

| ID | Ursprunglig risk | Ursprunglig nivå | Status | Åtgärd |
|---|---|---:|---|---|
| F-01 | Hela preview-filer lästes in i minnet vid serving | Hög | Åtgärdad | PR #3 streamar filer och stöder HEAD utan body |
| F-02 | Buffering av multipart/URL-artefakter ökade minnes-DoS-yta | Medium | Åtgärdad | PR #4 streamar inkommande artefakter till temporär fil |
| F-03 | Obegränsat antal aktiva previews och samtidiga importer per användare | Medium | Åtgärdad | PR #5 inför aktiva preview- och concurrency-gränser |
| F-04 | Ingen sammanlagd lagringskvot | Medium | Åtgärdad | PR #6 inför per-user och total kvot baserad på extraherad storlek |
| F-05 | Browser-session kunde leva vidare efter allowlist-revokering | Medium/Låg | Åtgärdad | PR #7 återkontrollerar allowlist på autentiserade requests |
| F-06 | Flytande GitHub Action-taggar och Node-basimage | Låg | Åtgärdad | PR #8 pinnar Actions till SHA och Node-image till digest |
| F-07 | Kontrollplan och previews kunde konfigureras under samma registrerbara domän | Medium designrisk | Åtgärdad | PR #9 kräver separat registrerbar preview-domän |

## Verifierade positiva kontroller

Följande kontroller har verifierats i kod och/eller CI:

- OAuth state genereras kryptografiskt och verifieras med konstanttidsjämförelse.
- GitHub-login kräver verifierad e-post och aktiv allowlist.
- Browser-cookie är `Secure`, `HttpOnly`, `SameSite=Lax` och host-only.
- Browser-sessioner och MCP-token återkontrolleras mot aktuell allowlist.
- Management-operationer är owner-scopade.
- Preview-ID:n genereras med kryptografisk slump.
- Endast exakt kontrollhost och giltiga preview-hosts accepteras.
- Preview-domän måste ligga utanför kontrollplanets registrerbara domän.
- Arkivimport blockerar traversal, absoluta paths, länkar och specialfiler.
- Import har gränser för komprimerad storlek, extraherad storlek, antal filer och path-längd.
- URL-import kräver HTTPS, blockerar privata/lokala mål och revaliderar redirects.
- Preview-filer streamas i stället för att bufferas helt i heap.
- Per-user concurrency och antal aktiva previews är begränsade.
- Persistent lagring har per-user och global kvot.
- Update använder staging och rollback-orienterad replacement.
- Produktionsprocessen kör som icke-root-användare i container.
- GitHub Actions är pinnade till commit-SHA.
- Node Docker-basimagen är pinnad till version och digest.

## CI-verifiering

Efter den avslutande domänisoleringen gick CI run #144 grönt.

CI omfattar:

- TypeScript typecheck
- unit tests
- security regression suite
- PostgreSQL integration tests
- full E2E
- Docker build
- validering av Coolify Compose

## Kvarvarande review-points och residualrisk

### R-01 – npm dependency advisories

**Status:** Bekräftad review-point, påverkan ännu inte verifierad  
**Allvarlighetsgrad:** Ej slutligt bedömd

Aktuell CI-logg från `npm ci` rapporterar:

- 3 vulnerabilities
- 2 moderate
- 1 high

Denna granskning har inte verifierat vilka transitiva paket/advisories som ligger bakom dessa tre poster eller om de är exploaterbara i produktionsvägen.

**Rekommendation:** kör och triagera `npm audit` mot aktuell lockfil. Uppgradera utan breaking changes där det går och dokumentera eventuell accepterad risk för resterande advisories.

### R-02 – Single-active-instance-antagande

**Status:** Känd arkitekturbegränsning  
**Allvarlighetsgrad:** Låg i nuvarande drift, högre vid framtida horisontell skalning

Concurrency- och lagringskvotkoordinering använder processlokala lås/räknare. Detta är korrekt för den dokumenterade v1-modellen med en aktiv applikationsinstans.

Vid flera samtidiga instanser kan kvotkontroller och locks kringgås genom parallell trafik mot olika instanser.

**Rekommendation:** innan horisontell skalning flyttas reservations-/låsningslogik till PostgreSQL eller annan distribuerad koordinering.

### R-03 – Temporär staging-lagring

**Status:** Känd residualrisk  
**Allvarlighetsgrad:** Låg/Medium beroende på diskstorlek

Lagringskvoten kontrollerar publicerad `READY`-storlek. En import måste först extraheras till staging innan exakt storlek kan räknas mot kvoten.

Arkivets maxgränser och samtidighetsgränser reducerar risken, men staging kan tillfälligt kräva extra disk.

**Rekommendation:** övervaka ledigt diskutrymme och överväg framtida global reservation/free-space guard om tjänsten får många användare.

### R-04 – CI-miljön är inte helt hermetisk

**Status:** Känd residualrisk  
**Allvarlighetsgrad:** Låg

Actions och Node-image är pinnade. GitHub-hosted `ubuntu-24.04` uppdateras dock av GitHub över tid och PostgreSQL-serviceimagen i CI använder `postgres:17-alpine`.

Detta påverkar främst reproducerbarhet och build-supply-chain, inte den deployade runtime-imagen direkt.

## Inte verifierat i denna granskning

Följande ligger utanför eller kunde inte fullt verifieras från repositoryt:

- faktisk Coolify/Traefik-konfiguration i den körande produktionsmiljön
- DNS- och TLS-konfiguration efter deployment
- hostens Linux-hardening, firewall och backup-policy
- PostgreSQL-rollernas faktiska produktionsprivilegier
- secrets-hantering i Coolify/GitHub
- övervakning, larm och incidenthantering
- extern penetrationstestning
- full dependency-advisory-triage för de tre npm-fynden

## Rekommenderad vidare granskning

Prioriterad ordning:

1. Triagera de tre npm-advisories som CI rapporterar.
2. Genomför ett kort deployed-environment-test av DNS/TLS/host-routing och auth.
3. Verifiera backup/restore för PostgreSQL och preview-volym.
4. Gör ny säkerhetsgranskning innan horisontell skalning eller införande av server-side builds.
5. Kör periodisk dependency- och container-image-uppdatering genom separata granskningsbara PR:er.

## Residual risk – slutsats

För den nuvarande avsedda användningen — allowlistad v1-tjänst, statiska previews, en aktiv applikationsinstans och separata registrerbara domäner — bedöms residualrisken som **låg till måttlig**.

Den viktigaste öppna punkten är dependency-triage. I övrigt är de ursprungliga verifierade fynden från denna granskning åtgärdade med regressionstester eller konfigurationsskydd.
