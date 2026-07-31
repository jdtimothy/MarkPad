// Per-repo settings live in MarkPad's own storage, never in the user's repo.
const DEFAULTS = { contentDir: '', imageDir: 'images', imageLinkStyle: 'relative' };

export function loadConfig(repo, guesses = {}) {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(`gh.config.${repo}`) || '{}');
  } catch {
    stored = {};
  }
  return { ...DEFAULTS, ...guesses, ...stored };
}

export function saveConfig(repo, config) {
  localStorage.setItem(`gh.config.${repo}`, JSON.stringify(config));
}
