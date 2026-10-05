(function () {
  document.querySelectorAll('.install-options').forEach(group => {
    const buttons = Array.from(group.querySelectorAll('[data-install-method]'));
    const command = group.querySelector('[data-install-command-text]');
    const copy = group.querySelector('.install-copy');
    const prompt = group.querySelector('.prompt');
    if (!buttons.length || !command || !copy) return;
    const defaultLabel = copy.dataset.defaultLabel || 'Copy command';
    const copiedLabel = copy.dataset.copiedLabel || 'Copied';
    let copyGeneration = 0;
    let feedbackTimer;

    function resetCopyFeedback() {
      window.clearTimeout(feedbackTimer);
      copy.classList.remove('is-copied');
      copy.setAttribute('aria-label', defaultLabel);
      copy.setAttribute('title', defaultLabel);
    }

    function select(button) {
      copyGeneration += 1;
      resetCopyFeedback();
      buttons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      command.textContent = button.dataset.command;
      copy.dataset.copyCommand = button.dataset.command;
      if (prompt) prompt.textContent = button.dataset.installMethod === 'powershell' ? '>' : '$';
    }

    copy.addEventListener('click', async () => {
      const generation = ++copyGeneration;
      const value = copy.dataset.copyCommand;
      resetCopyFeedback();
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(value);
          copied = true;
        } catch {}
      }
      if (generation !== copyGeneration) return;
      if (!copied) {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        try {
          textarea.select();
          copied = document.execCommand('copy');
        } catch {}
        finally { textarea.remove(); }
      }
      if (!copied) return;
      copy.classList.add('is-copied');
      copy.setAttribute('aria-label', copiedLabel);
      copy.setAttribute('title', copiedLabel);
      feedbackTimer = window.setTimeout(resetCopyFeedback, 1600);
    });

    buttons.forEach((button, index) => {
      button.addEventListener('click', () => select(button));
      button.addEventListener('keydown', event => {
        let next;
        if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
        if (event.key === 'ArrowLeft') next = (index + buttons.length - 1) % buttons.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = buttons.length - 1;
        if (next === undefined) return;
        event.preventDefault();
        select(buttons[next]);
        buttons[next].focus();
      });
    });
    const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent;
    const method = /win/i.test(platform) ? 'powershell' : /mac/i.test(platform) ? 'brew' : 'curl';
    select(buttons.find(button => button.dataset.installMethod === method) || buttons[0]);
  });
})();
