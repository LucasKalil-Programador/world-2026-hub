// stadiums.js — stadium cards: image, name, city, capacity, matches held.
// "View matches" jumps to the schedule pre-filtered by stadium.

import { getData, navigateTo } from './app.js';
import { t, getLocale } from './i18n.js';
import { setStadiumFilter } from './schedule.js';

export function initStadiums() {
  render();
  document.addEventListener('langchange', render);
}

function render() {
  const { stadiums, matches } = getData();
  const root = document.getElementById('stadiums-root');

  const matchCounts = new Map();
  for (const match of matches) {
    matchCounts.set(match.stadium, (matchCounts.get(match.stadium) ?? 0) + 1);
  }
  const numberFmt = new Intl.NumberFormat(getLocale());

  root.innerHTML = `
    <div class="stadiums-grid">
      ${stadiums.map((stadium) => stadiumCardHTML(stadium, matchCounts.get(stadium.name) ?? 0, numberFmt)).join('')}
    </div>`;

  for (const btn of root.querySelectorAll('[data-stadium]')) {
    btn.addEventListener('click', () => {
      setStadiumFilter(btn.dataset.stadium);
      navigateTo('matches');
    });
  }
}

function stadiumCardHTML(stadium, matchCount, numberFmt) {
  const matchWord = matchCount === 1 ? t('schedule.match') : t('schedule.matches');
  return `
    <article class="stadium-card glass hover-glow">
      <img class="stadium-img" src="assets/images/${stadium.image}" alt="${stadium.name}"
           width="400" height="225" loading="lazy">
      <div class="stadium-body">
        <h3 class="stadium-name">${stadium.name}</h3>
        <p class="stadium-city">${stadium.city}</p>
        <p class="stadium-stats">
          <span>${t('stadiums.capacity')}: <strong>${numberFmt.format(stadium.capacity)}</strong></span>
          <span class="stadium-match-count">${matchCount} ${matchWord}</span>
        </p>
        <button class="link-btn" data-stadium="${stadium.name}">${t('stadiums.viewMatches')} →</button>
      </div>
    </article>`;
}
