// storage.js — thin localStorage wrapper. All keys are prefixed wc2026_ and
// values are JSON-serialized. Never touch localStorage outside this module.

const PREFIX = 'wc2026_';

export function get(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function set(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // storage full or unavailable (private mode) — app keeps working without persistence
  }
}

export function getPrefs() {
  return get('prefs', {});
}

export function setPref(name, value) {
  const prefs = getPrefs();
  prefs[name] = value;
  set('prefs', prefs);
}

export function getFavorites() {
  return get('favorites', []);
}

export function toggleFavorite(teamId) {
  const favorites = getFavorites();
  const index = favorites.indexOf(teamId);
  if (index >= 0) favorites.splice(index, 1);
  else favorites.push(teamId);
  set('favorites', favorites);
  return favorites;
}
