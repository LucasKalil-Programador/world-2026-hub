// i18n.js — EN/PT-BR dictionaries + t(key). Every UI string in the app goes
// through t(); static HTML uses data-i18n / data-i18n-aria attributes.
// Language persists in wc2026_prefs.lang; changing it dispatches "langchange"
// so modules can re-render dynamic content.

import { getPrefs, setPref } from './storage.js';

const dicts = {
  en: {
    'a11y.skip': 'Skip to content',
    'a11y.mainNav': 'Main navigation',
    'a11y.langSwitch': 'Switch language',
    'nav.home': 'Home',
    'nav.matches': 'Matches',
    'nav.groups': 'Groups',
    'nav.bracket': 'Knockout',
    'nav.stadiums': 'Stadiums',
    'hero.live': 'Live',
    'hero.nextMatch': 'Next match',
    'hero.kickoff': 'Kickoff!',
    'hero.countdownLabel': 'Time until kickoff',
    'hero.vs': 'vs',
    'countdown.days': 'days',
    'countdown.hours': 'hours',
    'countdown.minutes': 'min',
    'countdown.seconds': 'sec',
    'dash.title': 'Tournament overview',
    'dash.total': 'Total matches',
    'dash.completed': 'Completed',
    'dash.upcoming': 'Upcoming',
    'dash.teams': 'Teams',
    'app.loading': 'Loading data…',
    'app.error': 'Could not load tournament data.',
    'app.errorHint': 'If you opened index.html directly from disk, serve the folder instead: python -m http.server',
    'app.comingSoon': 'This section arrives in a later build step.',
    'app.tbd': 'TBD',
    'phase.group': 'Group',
    'phase.r32': 'Round of 32',
    'phase.r16': 'Round of 16',
    'phase.qf': 'Quarterfinals',
    'phase.sf': 'Semifinals',
    'phase.third': 'Third Place',
    'phase.final': 'Final',
    'schedule.searchPlaceholder': 'Search team, city or stadium…',
    'schedule.dateFilter': 'Filter by date',
    'schedule.allGroups': 'All groups',
    'schedule.allPhases': 'All phases',
    'schedule.groupStage': 'Group stage',
    'schedule.allTeams': 'All teams',
    'schedule.allStadiums': 'All stadiums',
    'schedule.sortAsc': 'Date ↑',
    'schedule.sortDesc': 'Date ↓',
    'schedule.match': 'match',
    'schedule.matches': 'matches',
    'schedule.noResults': 'No matches found — adjust the filters.',
    'schedule.clear': 'Clear filters',
    'status.finished': 'Full-time',
    'status.pens': 'pens',
    'standings.team': 'Team',
    'standings.played': 'P',
    'standings.won': 'W',
    'standings.drawn': 'D',
    'standings.lost': 'L',
    'standings.gf': 'GF',
    'standings.ga': 'GA',
    'standings.gd': 'GD',
    'standings.pts': 'Pts',
    'standings.legendTop2': 'Advance to the Round of 32',
    'standings.legendThird': 'In contention for best third place',
    'standings.inProgress': 'In progress',
    'stadiums.capacity': 'Capacity',
    'stadiums.viewMatches': 'View matches',
    'status.scheduled': 'Scheduled',
    'modal.close': 'Close',
    'modal.date': 'Date & time',
    'modal.stadium': 'Stadium',
    'modal.city': 'City',
    'modal.stats': 'Match stats',
    'modal.possession': 'Possession',
    'modal.shots': 'Shots',
    'modal.cards': 'Cards',
    'modal.statsSoon': 'Detailed stats will appear here once available.',
    'bracket.groupWinner': 'Group {g} Winner',
    'bracket.groupRunnerUp': 'Group {g} Runner-up',
    'bracket.bestThird': 'Best 3rd #{n}',
    'bracket.champion': 'Champion',
    'bracket.zoomIn': 'Zoom in',
    'bracket.zoomOut': 'Zoom out',
    'bracket.zoomReset': 'Reset zoom',
    'sim.mode': 'Simulation',
    'sim.reset': 'Reset picks',
    'sim.hint': 'Simulation on — click a highlighted match to pick its winner. Real results are never changed.',
    'sim.title': 'Simulate',
    'sim.pickWinner': 'Pick the winner. Equal or empty score means penalties.',
    'sim.save': 'Save pick',
    'sim.clear': 'Remove pick',
    'sim.chip': 'SIM',
    'time.local': 'Local time',
    'time.stadium': 'Stadium time',
    'time.toggleAria': 'Toggle between local and stadium time',
    'schedule.myMatches': 'My matches',
    'fav.toggle': 'Favorite',
    'challenge.title': 'Bracket challenge',
    'challenge.correct': '{x} of {y} picks correct',
    'share.button': 'Share prediction',
    'share.copied': 'Link copied!',
    'share.confirm': 'Apply the shared prediction? Your current picks will be replaced.',
    'modal.addCalendar': 'Add to calendar',
    'footer.note': 'Fan-made static hub — all data lives in JSON files.',
  },
  pt: {
    'a11y.skip': 'Pular para o conteúdo',
    'a11y.mainNav': 'Navegação principal',
    'a11y.langSwitch': 'Trocar idioma',
    'nav.home': 'Início',
    'nav.matches': 'Partidas',
    'nav.groups': 'Grupos',
    'nav.bracket': 'Mata-mata',
    'nav.stadiums': 'Estádios',
    'hero.live': 'Ao vivo',
    'hero.nextMatch': 'Próxima partida',
    'hero.kickoff': 'Bola rolando!',
    'hero.countdownLabel': 'Tempo até o início da partida',
    'hero.vs': 'vs',
    'countdown.days': 'dias',
    'countdown.hours': 'horas',
    'countdown.minutes': 'min',
    'countdown.seconds': 'seg',
    'dash.title': 'Visão geral do torneio',
    'dash.total': 'Total de partidas',
    'dash.completed': 'Encerradas',
    'dash.upcoming': 'Próximas',
    'dash.teams': 'Seleções',
    'app.loading': 'Carregando dados…',
    'app.error': 'Não foi possível carregar os dados do torneio.',
    'app.errorHint': 'Se você abriu o index.html direto do disco, sirva a pasta: python -m http.server',
    'app.comingSoon': 'Esta seção chega em uma próxima etapa.',
    'app.tbd': 'A definir',
    'phase.group': 'Grupo',
    'phase.r32': '16 avos de final',
    'phase.r16': 'Oitavas de final',
    'phase.qf': 'Quartas de final',
    'phase.sf': 'Semifinais',
    'phase.third': 'Disputa de 3º lugar',
    'phase.final': 'Final',
    'schedule.searchPlaceholder': 'Buscar seleção, cidade ou estádio…',
    'schedule.dateFilter': 'Filtrar por data',
    'schedule.allGroups': 'Todos os grupos',
    'schedule.allPhases': 'Todas as fases',
    'schedule.groupStage': 'Fase de grupos',
    'schedule.allTeams': 'Todas as seleções',
    'schedule.allStadiums': 'Todos os estádios',
    'schedule.sortAsc': 'Data ↑',
    'schedule.sortDesc': 'Data ↓',
    'schedule.match': 'partida',
    'schedule.matches': 'partidas',
    'schedule.noResults': 'Nenhuma partida encontrada — ajuste os filtros.',
    'schedule.clear': 'Limpar filtros',
    'status.finished': 'Encerrado',
    'status.pens': 'pên.',
    'standings.team': 'Seleção',
    'standings.played': 'J',
    'standings.won': 'V',
    'standings.drawn': 'E',
    'standings.lost': 'D',
    'standings.gf': 'GP',
    'standings.ga': 'GC',
    'standings.gd': 'SG',
    'standings.pts': 'Pts',
    'standings.legendTop2': 'Avançam aos 16 avos de final',
    'standings.legendThird': 'Na briga por melhor 3º lugar',
    'standings.inProgress': 'Em andamento',
    'stadiums.capacity': 'Capacidade',
    'stadiums.viewMatches': 'Ver partidas',
    'status.scheduled': 'Agendada',
    'modal.close': 'Fechar',
    'modal.date': 'Data e hora',
    'modal.stadium': 'Estádio',
    'modal.city': 'Cidade',
    'modal.stats': 'Estatísticas',
    'modal.possession': 'Posse de bola',
    'modal.shots': 'Finalizações',
    'modal.cards': 'Cartões',
    'modal.statsSoon': 'Estatísticas detalhadas aparecerão aqui quando disponíveis.',
    'bracket.groupWinner': '1º do Grupo {g}',
    'bracket.groupRunnerUp': '2º do Grupo {g}',
    'bracket.bestThird': 'Melhor 3º #{n}',
    'bracket.champion': 'Campeão',
    'bracket.zoomIn': 'Aproximar',
    'bracket.zoomOut': 'Afastar',
    'bracket.zoomReset': 'Restaurar zoom',
    'sim.mode': 'Simulação',
    'sim.reset': 'Limpar palpites',
    'sim.hint': 'Simulação ativa — clique numa partida destacada para escolher o vencedor. Resultados reais nunca mudam.',
    'sim.title': 'Simular',
    'sim.pickWinner': 'Escolha o vencedor. Placar igual ou vazio indica pênaltis.',
    'sim.save': 'Salvar palpite',
    'sim.clear': 'Remover palpite',
    'sim.chip': 'SIM',
    'time.local': 'Hora local',
    'time.stadium': 'Hora do estádio',
    'time.toggleAria': 'Alternar entre hora local e do estádio',
    'schedule.myMatches': 'Minhas partidas',
    'fav.toggle': 'Favoritar',
    'challenge.title': 'Bolão do mata-mata',
    'challenge.correct': '{x} de {y} palpites certos',
    'share.button': 'Compartilhar palpites',
    'share.copied': 'Link copiado!',
    'share.confirm': 'Aplicar os palpites compartilhados? Seus palpites atuais serão substituídos.',
    'modal.addCalendar': 'Adicionar à agenda',
    'footer.note': 'Hub estático feito por fãs — todos os dados vivem em arquivos JSON.',
  },
};

let lang = 'en';

export function initI18n() {
  const saved = getPrefs().lang;
  lang = saved ?? (navigator.language?.toLowerCase().startsWith('pt') ? 'pt' : 'en');
  document.documentElement.lang = getLocale();
  applyI18n();
}

export function t(key) {
  return dicts[lang][key] ?? dicts.en[key] ?? key;
}

export function getLang() {
  return lang;
}

export function getLocale() {
  return lang === 'pt' ? 'pt-BR' : 'en-US';
}

export function setLang(next) {
  if (next === lang || !dicts[next]) return;
  lang = next;
  setPref('lang', next);
  document.documentElement.lang = getLocale();
  applyI18n();
  document.dispatchEvent(new CustomEvent('langchange'));
}

export function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  }
}

// Phase labels come from matches.json in English ("Group A", "Round of 32"…);
// translate the known ones, pass anything else through untouched.
const PHASE_KEYS = {
  'Round of 32': 'phase.r32',
  'Round of 16': 'phase.r16',
  Quarterfinals: 'phase.qf',
  Semifinals: 'phase.sf',
  'Third Place': 'phase.third',
  Final: 'phase.final',
};

export function translatePhase(phase) {
  if (phase.startsWith('Group ')) return `${t('phase.group')} ${phase.slice(6)}`;
  const key = PHASE_KEYS[phase];
  return key ? t(key) : phase;
}
