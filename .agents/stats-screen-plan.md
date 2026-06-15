# Plano de Implementação — Tela de Estatísticas Finais (World Cup 2026 Hub)

> Documento de planejamento (NÃO é implementação). Gerado em 2026-06-14 após workflow multi-agente
> (5 perspectivas) + aprovação da lista de dados pelo usuário. Escopo aprovado: **as 4 camadas**
> (✅ existentes · 🟡🧩 acréscimos baratos · 🔴 dados de jogadores · 📝 editorial).
>
> **PRINCÍPIO REITOR (requisito explícito do usuário):** *degradação graciosa*. Quando um dado não
> puder ser obtido, o tratamento deve ser elegante — **não pode quebrar a UI nem deixar visível para o
> usuário final que algo está faltando**. Sem `—`, sem cards vazios, sem "dados em breve". A regra é:
> **um dado/seção só aparece quando está completo o bastante para ser apresentado como autoritativo;
> caso contrário é removido do DOM** (não escondido com placeholder, *removido*). Ver §0 e §6.

---

## 0 · Camada de degradação graciosa (a espinha dorsal de todo o resto)

Esta é a peça arquitetural mais importante do plano. Tudo abaixo se apoia nela.

### 0.1 Contrato de disponibilidade
Cada estatística, card, linha de tabela e sub-seção declara um predicado `isAvailable(model)`:
- **Sub-seção inteira sem dados** → a seção **não é renderizada** e seu chip no sub-nav **é removido**
  (navegação nunca aponta para o vazio).
- **Card/recorde individual sem dados** → o card não é inserido; o grid reflui naturalmente.
- **Célula opcional numa linha** (ex.: xG de um time sem feed) → a coluna some para todos OU a célula
  cai para um valor neutro só se isso não denunciar ausência. Preferência: **a coluna inteira só existe
  se todos os times tiverem o dado.**
- **Agregado sobre `stats` esparso** (posse/chutes/cartões) → só renderiza com **cobertura completa**
  (todos os jogos da amostra relevante preenchidos). Sem cobertura → **escondido, sem disclaimer**.
  (Decisão: o usuário NÃO quer "baseado em N jogos" visível. Ou faz backfill total, ou não mostra.)

### 0.2 Carga de dados tolerante a falha
`loadData()` em `app.js` passa a buscar os novos JSON; cada fetch novo é **opcional**:
arquivo ausente / 404 / JSON inválido → `console.warn` (dev) + **default vazio** (`[]`/`{}`),
**nunca** exceção que derrube o app. Os 6 arquivos atuais continuam obrigatórios.

### 0.3 Mídia com fallback
Fotos de jogadores / bandeiras quebradas → `onerror` cai para iniciais (monograma) ou silhueta
genérica. Nunca ícone de imagem quebrada.

### 0.4 Camadas se auto-desligam
- Sem `players.json`/eventos → **toda** a seção Jogadores + Prêmios + comparador de jogadores +
  recordes de tempo de gol somem (chips inclusive). A tela continua completa só com dados de time.
- Sem `curiosities.json` → Recordes mostra só os auto-deriváveis; nada de "em breve".
- Sem `attendance` → recordes de público somem; o resto do Overview fica intacto.

Resultado: a mesma base de código entrega uma tela coerente e "cheia" com **só os dados existentes
hoje**, e vai "acendendo" seções conforme os dados das camadas 2/3/4 forem entrando — sem nenhuma
data de corte nem buraco visível.

---

## 1 · Arquitetura da tela

### 1.1 Estrutura de componentes (segue o padrão por-view existente)
```
index.html
 ├─ nav.tabs            + <button data-tab="stats" ...>  (6º tab, após Stadiums)
 └─ <section id="panel-stats" class="panel" role="tabpanel" hidden>
       <h2 class="section-title" data-i18n="nav.stats">…</h2>
       <div id="stats-root"><p class="placeholder glass" data-i18n="app.comingSoon"></p></div>

assets/js/stats.js   (NOVO módulo — espelha schedule.js/groups.js/bracket.js)
   - initStats()                  chamado por app.js (mesmo padrão de import circular intencional)
   - buildStatsModel(data)        deriva TODO o modelo computável 1x, memoizado
   - renderStats() / renderSection(id)   render preguiçoso por seção (IntersectionObserver)
   - escuta langchange (re-render só de labels) / favchange / timemodechange

assets/css/stats.css   (NOVO — como bracket.css; componentes da tela de stats)
```

### 1.2 Rotas
- Hash route `#stats` + persistência `wc2026_prefs.lastTab` → **de graça** (roteamento por hash já existe).
- Sub-navegação interna **não** é rota nem segundo `tablist`: é uma `<nav>` de âncoras (`#stats-teams`…)
  com *scrollspy* via IntersectionObserver (evita conflito de setas com o `tablist` do topo — ver §3).
- Opcional (nice-to-have): deep-link `#stats=players` que faz scroll até a seção ao carregar.

### 1.3 Estado global
- **Nenhum estado persistente novo é obrigatório.** O modelo de stats é derivado de `getData()` e
  **memoizado em memória** no módulo (`let statsModel`); recalcula só se os dados mudarem (não mudam
  em runtime). `langchange` re-renderiza labels, **não** recomputa valores (nomes não se traduzem).
- Reusa estado existente: `wc2026_favorites` (destaque dourado em linhas/cards do time favorito),
  `wc2026_prefs.timeMode` (arquivo de resultados + modal).
- Opcional: `wc2026_prefs.statsSort` p/ lembrar a última ordenação de tabela (baixa prioridade).

### 1.4 Integração com o existente (reuso, não reinvenção)
- `openMatchModal(matchId)` → cards de recorde, linhas do arquivo e qualquer linha ligada a um jogo.
- `resolveBracketTeams`, `computeStandings`, `getBracketTree`, `calculateChallengeScore` → reusados
  para ranking, caminho do campeão, fase alcançada.
- `t(key)`, eventos `langchange`/`favchange`/`timemodechange`, `.glass`, `.slide-up`, `.container`.
- `DATA_VERSION` (cache-busting) **deve ser bumpado** quando os novos `data/*.json` entrarem no
  `Promise.all` de `loadData()`.

---

## 2 · Fontes de dados

### 2.1 Já existe (Camada 1 — ~70% da tela, zero coleta)
`teams.json`, `groups.json`, `matches.json`, `results.json` (placar/status/penalties + `stats`
opcional), `stadiums.json` (capacidade, timezone), `bracket-config.json`. Computados: standings,
bracket, challenge.

### 2.2 Precisa coletar/calcular

| Camada | Arquivo / campo novo | Schema | Destrava | Esforço |
|---|---|---|---|---|
| 🟡 2 | `results.json` → `attendance` | inteiro por jogo | público total/médio/ocupação, maior público | dado público FIFA |
| 🟡 2 | `results.json` → `cards: {home:{y,r}, away:{y,r}}` | split amarelo/vermelho | disciplina completa, fair-play | reformatar campo atual |
| 🟡 2 | `results.json` → `decidedIn` | `"regulation"\|"ET"\|"penalties"` | separar prorrogação de pênaltis | trivial |
| 🟡 2 | `results.json` → backfill `stats` nos 104 | posse/chutes existentes | posse/chutes/conversão como agregado confiável | médio (104 jogos) |
| 🟡 2 | `results.json` → `shotsOnTarget`, `passes`, `passAccuracy` (opc.) | nível time | chutes no alvo, passes | opcional |
| 🧩 2 | `teams.json` → `ranking`/`seed`, `wcDebut`, `confederation` | por time | zebras, Cinderela, estreantes, desempenho por confederação | trivial 1x |
| 🧩 2 | `stadiums.json` → `lat`,`lng` | por estádio | distância total percorrida | trivial 1x |
| 🔴 3 | `players.json` | roster mínimo `{id,name,team,position,birthDate,shirt?}` — só envolvidos | base de todos os individuais | médio |
| 🔴 3 | `player-events.json` | log append-only `{type:goal\|card\|ownGoal, player, team, matchId, minute, goalType?, assist?, card?}` | artilharia, hat-tricks, tempo de gol, disciplina | **alto, ~400+ linhas** |
| 🔴 3 | `awards.json` | `{goldenBall, goldenBoot, goldenGlove, bestYoung, squadOfTournament[], goalOfTournament}` | prêmios FIFA + Seleção do Torneio | trivial (1x pós-final) |
| 🔴 3 | (opc.) `keeper-stats.json` | defesas/clean-sheets por goleiro | Luva de Ouro detalhada | opcional |
| 📝 4 | `curiosities.json` | array de cards `{id,type,priority,titleEN/PT,bodyEN/PT,matchId?,teamId?,mediaRef?,statRef?}` | gol mais bonito, VAR, histórias | redação bilíngue |
| 📝 4 | `all-time-baselines.json` (ou embutido) | recordes históricos fixos p/ comparação | painel "esta Copa vs história" | trivial 1x |

> **Decisão de modelagem (jogadores):** usar **roster + log de eventos** (não agregados pré-somados).
> O log deriva tudo (artilharia, assistências, hat-tricks, gol mais rápido/jovem/tardio) com o mesmo
> padrão do projeto (results.json é por jogo; o código computa o resto). Minutos jogados e defesas de
> goleiro — caros por evento — ficam como **agregado opcional** (`keeper-stats.json`) ou são omitidos.
> Entrada **incremental por rodada** (encaixa no fluxo diário `/update-worldcup`), não num lote único.

### 2.3 Fora de escopo v1
- **xG**: não existe feed; exige provedor externo. Slot de UI previsto, **escondido** até haver dado.
- Distância percorrida por jogador, dribles, sprints: custo de manutenção alto demais para site estático.

---

## 3 · UI/UX — Proposta de navegação (wireframe textual)

**Colocação:** novo 6º tab `Stats` / `Estatísticas`, último (é o epílogo do torneio). Reusa o
`tablist` WAI-ARIA existente (roving tabindex, Setas/Home/End) — zero paradigma novo.

**Sub-navegação:** barra de chips *sticky* (scrollspy) abaixo do hero — **`<nav>` de âncoras, não um
segundo tablist** (evita conflito de Setas com o tab do topo; é também o gatilho do render preguiçoso).
Chips: **Overview · Times · Jogadores · Recordes · Comparador · Arquivo** (chips de seções vazias somem).

```
┌─ #panel-stats ───────────────────────────────────────────────────────────┐
│  ╔═ HERO "o veredito" (glass, slide-up) ════════════════════════════════╗ │
│  ║  🏆 CAMPEÃO  [bandeira]      vice · 3º · Chuteira de Ouro · Seleção   ║ │
│  ║   [ 172 ]    [ 2.68 ]     [ 31 ]        [ 3.1M ]   ← tiles count-up   ║ │
│  ║   Gols       Gols/jogo    Pênaltis      Público                       ║ │
│  ╚═══════════════════════════════════════════════════════════════════════╝ │
│  ┌─ SUB-NAV sticky (scrollspy) ● Overview Times Jogadores … Arquivo ───┐  │
│  ═══ #stats-overview ═══ cards (Partidas/Média/Cartões/Clean sheets) +   │
│        CHART "gols por fase" (barras SVG, reveal) + "gols por rodada"     │
│  ═══ #stats-teams ═══ filtros[confederação▾ fase▾ ⌕] +                    │
│        LEADERBOARD ordenável (#, time, P W E D, GF GA GD, Pts, [xG]) +    │
│        cards: maior goleada, caminho do campeão, forma V/E/D             │
│  ═══ #stats-players ═══ PÓDIO top-3 (Chuteira de Ouro, count-up) +        │
│        chips[Artilheiros·Assist·Cartões·Defesas] → troca corpo da tabela +│
│        bloco PRÊMIOS + SELEÇÃO DO TORNEIO (gráfico de formação)          │
│  ═══ #stats-records ═══ grid de record-cards (auto) + faixa "ESTREIAS DO  │
│        FORMATO 48" (destaque) + cards editoriais (curiosities.json)      │
│  ═══ #stats-comparator ═══ [A▾] vs [B▾]  toggle Times/Jogadores +         │
│        barras divergentes espelhadas (anima na escolha)                  │
│  ═══ #stats-archive ═══ 104 resultados, accordion por fase, filtros/sort, │
│        linha → openMatchModal()  (preguiçoso, por último)                │
└───────────────────────────────────────────────────────────────────────────┘
```
Acima da dobra (desktop): hero veredito + 4 tiles + sub-nav. O resto é recompensa de scroll.

**Componentes reutilizáveis:** `stat-card` (tile count-up), `leaderboard-table` (ordenável, a11y,
linha favorita dourada), `podium` (top-3), `record-card` (clica → modal), `chart-panel` (SVG/CSS +
`<details>` tabela alternativa), `comparator`, `filter-bar`, `section-nav` (scrollspy),
`results-archive`, `chip-tabs` (toggle intra-seção via `aria-pressed`, não tablist).

**Interações/animações** (todas atrás de `prefers-reduced-motion`):
count-up dos números (IntersectionObserver, ~900ms ease-out), barras crescendo da base,
linha com `stroke-dashoffset`, FLIP no re-sort, duelo de barras no comparador, reveal por seção.

**Responsividade:** ≤767 hero empilha + tiles 2×2, sub-nav scroll horizontal com snap, tabelas com
rank+nome congelados e scroll-x numa região focável; 768–1439 grids 2-col; 1440+ `.container`
(`min(1200px,100%-2rem)`), grid 4-col, hero numa linha.

**Acessibilidade:** `<table>` real com `<caption>`/`scope`/`aria-sort` (header ordenável = `<button>`);
sub-nav é `<nav>` (não tablist); charts com alternativa textual (`<details>` tabela + `aria-label`);
count-up: valor final é o DOM real, tween só visual (`aria-live="off"`); foco visível via
`:focus-visible` existente.

---

## 4 · Stack e dependências

**Princípio:** zero dependência nova de runtime. Mantém o mandato do projeto (vanilla ES Modules, sem
framework/bundler/CDN) e o orçamento de **JS < 300KB (hoje ~74KB)**.

- **Gráficos: SEM biblioteca.** Barras/linhas/donut feitos à mão em **SVG inline + CSS** (casa com a
  estética e com o orçamento). Se um gráfico realmente exigir mais, `import()` dinâmico de micro-lib
  (<poucos KB) só quando a seção entra na viewport — **postura padrão: peso zero de chart-lib.**
- **Animação:** reusa `animations.css` + IntersectionObserver; helper `countUp()` em vanilla
  (`requestAnimationFrame`). Tudo desligado em `prefers-reduced-motion`.
- **i18n:** novo namespace `stats.*` em `i18n.js` (dicts EN **e** PT). Nomes de dados não se traduzem.
- **CSS:** novo `assets/css/stats.css` (linkado no `<head>` como `bracket.css`), usando os tokens
  existentes (`--accent-gold`, `--glass-bg`, `--radius`, etc.).
- **Tooling opcional (não-shippado):** script Node sem deps para gerar/validar agregados de jogadores
  a partir do log de eventos — facilita a entrada manual. Fora do bundle do site.

---

## 5 · Roadmap de implementação (incremental, com portões de aprovação)

> Convenção do projeto: 1 etapa por vez, resumo + aprovação antes da próxima. Esforço: **S** ≈ meia
> sessão · **M** ≈ 1 sessão · **L** ≈ ~2 sessões. Etapas A–F entregam uma tela completa só com dados
> existentes; G–I acendem as camadas 2/3/4; J é polimento.

| # | Etapa | Entrega | Camada | Esforço |
|---|---|---|---|---|
| **A** | **Scaffolding + motor de degradação** | 6º tab, `#panel-stats`, `stats.js`, `stats.css`, namespace `stats.*`, render preguiçoso, scrollspy, `loadData()` tolerante a falha, contrato `isAvailable` (§0) | infra | **M** |
| **B** | **Overview + Hero** | veredito (campeão/vice/3º/4º), 4 tiles count-up, gráfico gols-por-fase e gols-por-rodada | ✅1 | **M** |
| **C** | **Estatísticas de times** | `leaderboard-table` ordenável+a11y, **ranking final 1–48 (cadeia de desempate)**, cards (maior goleada, caminho do campeão, forma, splits, clean sheets, sequências) | ✅1 | **L** |
| **D** | **Recordes + Estreias do formato 48** | record-cards auto-deriváveis + faixa de destaque "104 jogos / maior caminho à final / Round of 32 / melhor 3º / 1º campeão da nova era" | ✅1 | **M** |
| **E** | **Arquivo de resultados** | 104 jogos navegáveis, filtros/sort, linha → modal (reusa padrões de `schedule.js`) | ✅1 | **M** |
| **F** | **Comparador de times** | seletor A vs B + barras divergentes animadas | ✅1 | **M** |
| **G** | **Camada 2 — dados baratos** | estende `results.json` (attendance, cards y/r, decidedIn), `teams.json` (ranking/wcDebut/confederation), `stadiums.json` (coords); backfill `stats`; liga recordes de público, disciplina, zebras, distância | 🟡🧩2 | **M** + entrada de dados |
| **H** | **Camada 3 — jogadores** | `players.json`+`player-events.json`+`awards.json`; pódio artilharia, chips (assist/cartões/defesas), bloco de prêmios, **Seleção do Torneio** (formação), comparador de jogadores, recordes de tempo de gol | 🔴3 | **L** (maior) + entrada contínua |
| **I** | **Camada 4 — editorial** | `curiosities.json` + `all-time-baselines.json`; render de cards editoriais + painel "esta Copa vs história" | 📝4 | **M** + redação |
| **J** | **Polimento** | auditoria responsiva/a11y, performance (lazy, sem blur em cards repetidos), Lighthouse, bump `DATA_VERSION`, README + i18n review | todas | **M** |

Caminho mínimo para uma tela publicável e bonita: **A→B→C→D→E→F** (tudo com dados de hoje).
G/H/I são aditivos e podem entrar em qualquer ordem conforme os dados aparecem (graças a §0).

---

## 6 · Pontos de atenção (edge cases, dados incompletos, fallbacks)

1. **Torneio ainda não acabou (hoje 2026-06-14).** A tela é pós-Copa. Campeão/ranking só existem após
   a final → o **hero veredito não renderiza** enquanto `FINAL` não estiver `finished`. Opção: manter o
   tab **oculto** até a final terminar, ou deixá-lo "acender" progressivamente. Decidir antes da Etapa B.
2. **`stats` esparso (hoje ~9/104).** Agregados de posse/chutes/cartões só aparecem com **cobertura
   completa**; senão ficam escondidos (sem disclaimer — requisito do usuário). Backfill é a Etapa G.
3. **`cards` é só amarelo hoje.** Índice de disciplina/fair-play e "time mais faltoso" ficam
   incompletos até o split y/r (Etapa G). Antes disso: rotular como "amarelos" ou esconder.
4. **Convenção de V/E/D no mata-mata.** Empate decidido nos pênaltis conta como empate (para gols) mas
   vitória/derrota (para avanço). Definir e documentar na camada de dados antes de somar retrospectos.
5. **Desempate do ranking 1–48.** Cadeia determinística explícita: fase alcançada → pontos → SG → GP →
   (fallback id). Documentar; sem isso o ranking não é reproduzível.
6. **Burden e confiabilidade dos dados de jogador.** ~400+ linhas manuais; risco de typo/evento
   perdido. Usar **uma fonte autoritativa** (site oficial FIFA), entrada incremental por rodada. UI
   esconde seções/linhas sem dado (§0) — nunca mostra lacuna.
7. **Editorial bilíngue.** Todo card de `curiosities.json` precisa EN **e** PT; se faltar um idioma,
   *fallback* para o outro (não renderiza em branco).
8. **Performance.** Render preguiçoso por seção; **sem `backdrop-filter` em cards repetidos** (custo de
   paint — regra já vigente no projeto); charts em SVG/CSS sem lib; memoizar o modelo.
9. **Cache-busting & deploy.** Bumpar `DATA_VERSION` quando novos `data/*.json` entrarem; novos
   arquivos em `data/` **são** deployados (bom); `.agents/` (este plano) é excluído (bom). Paths
   relativos para fotos de jogador (gotcha #7 — subpath Hostinger/Pages).
10. **Não quebrar o existente.** Manter o padrão de import circular com `app.js`; novo tab não pode
    alterar o contrato do `tablist`/roteamento atual.
11. **Mídia ausente.** Fotos de jogador/bandeiras → `onerror` para monograma/silhueta; nunca imagem
    quebrada.
12. **xG sem feed.** Coluna/seção xG só existe se todos os times tiverem o dado; senão, removida (não
    mostrar coluna pela metade).

---

## Apêndice — proveniência
Consolidado de 5 sub-agentes (Times, Individuais, Partidas, Curiosidades, UX). Lista completa de
métricas com tags de disponibilidade está no histórico da sessão de 2026-06-14 (Fase 1). Escopo
aprovado: 4 camadas + degradação graciosa como requisito de primeira ordem.
