export function createCommitBar() {
  const bar = document.getElementById('commit-bar');
  const input = document.getElementById('commit-message');
  const go = document.getElementById('commit-go');
  const cancel = document.getElementById('commit-cancel');
  let resolve = null;

  function close(value) {
    bar.classList.add('hidden');
    const done = resolve;
    resolve = null;
    done?.(value);
  }

  go.addEventListener('click', () => close(input.value.trim() || input.placeholder));
  cancel.addEventListener('click', () => close(null));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); go.click(); }
    if (e.key === 'Escape') { e.preventDefault(); close(null); }
  });

  // Resolves with the message, or null if the user cancels.
  function ask(defaultMessage) {
    return new Promise((r) => {
      resolve = r;
      input.value = defaultMessage;
      input.placeholder = defaultMessage;
      bar.classList.remove('hidden');
      input.focus();
      input.select();
    });
  }

  return { ask };
}

// Resolves to 'overwrite' | 'reload' | 'browse' | 'cancel'.
export function askConflict(detail) {
  const dialog = document.getElementById('conflict-dialog');
  document.getElementById('conflict-detail').textContent = detail;
  return new Promise((resolve) => {
    const choose = (value) => () => { dialog.close(); resolve(value); };
    const buttons = [
      ['conflict-overwrite', 'overwrite'],
      ['conflict-reload', 'reload'],
      ['conflict-browse', 'browse'],
      ['conflict-cancel', 'cancel'],
    ].map(([id, value]) => {
      const el = document.getElementById(id);
      const handler = choose(value);
      el.addEventListener('click', handler, { once: true });
      return [el, handler];
    });
    dialog.addEventListener('close', () => {
      for (const [el, handler] of buttons) el.removeEventListener('click', handler);
      resolve('cancel');
    }, { once: true });
    dialog.showModal();
  });
}
