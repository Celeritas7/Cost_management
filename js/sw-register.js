if ('serviceWorker' in navigator) {
  const workers = navigator.serviceWorker;
  let controlled = Boolean(workers.controller);

  workers.addEventListener('controllerchange', () => {
    // A running page keeps its current JavaScript until reloaded. Let the user finish their entry.
    if (controlled && !document.getElementById('cm-update-button')) {
      const button = document.createElement('button');
      button.id = 'cm-update-button';
      button.type = 'button';
      button.textContent = 'Update ready · Reload app';
      button.style.cssText = 'position:fixed;z-index:10000;top:max(8px,env(safe-area-inset-top));right:8px;padding:12px 16px;border:1px solid #729aff;border-radius:12px;background:#243452;color:white;font:600 14px system-ui;cursor:pointer';
      button.addEventListener('click', () => location.reload());
      document.body.appendChild(button);
    }
    controlled = Boolean(workers.controller);
  });

  window.addEventListener('load', async () => {
    try {
      const reg = await workers.register('sw.js', { updateViaCache: 'none' });
      let lastCheck = Date.now();
      const check = () => {
        if (document.visibilityState !== 'visible' || !navigator.onLine || Date.now() - lastCheck < 60000) return;
        lastCheck = Date.now();
        reg.update().catch(console.warn);
      };
      document.addEventListener('visibilitychange', check);
      window.addEventListener('online', check);
      if (reg.active && !reg.installing && navigator.onLine) await reg.update();
    } catch (error) {
      console.warn('Cost app update check unavailable', error);
    }
  });
}
