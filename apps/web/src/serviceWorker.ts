export function registerAppServiceWorker(
  isProduction: boolean,
  serviceWorker: ServiceWorkerContainer | undefined = navigator.serviceWorker,
): void {
  if (!isProduction || !serviceWorker) return;
  void serviceWorker.register("/sw.js").catch((error: unknown) => {
    console.error("Service worker registration failed.", error);
  });
}
