"use strict";
// OneSignal Web SDK v16; independent service worker scope for GitHub Pages subdirectory.
(() => {
  const byId = id => document.getElementById(id);
  const btn = byId("enablePush");
  const state = byId("pushState");
  const box = byId("subscriptionBox");
  const idEl = byId("pushSubscriptionId");
  const copy = byId("copySubscription");
  if (!btn || !state) return;

  function note(text) { state.textContent = text; }
  let oneSignal = null;
  function render() {
    if (!oneSignal) return;
    const id = oneSignal.User.PushSubscription.id;
    const optedIn = oneSignal.User.PushSubscription.optedIn;
    const permitted = oneSignal.Notifications.permission;
    const ready = Boolean(id && optedIn && permitted);
    btn.textContent = ready ? "Сповіщення вже ввімкнено" : "Увімкнути push-сповіщення";
    btn.disabled = ready;
    box.classList.toggle("hidden", !ready);
    if (ready) {
      idEl.textContent = id;
      note("Push підписка активна. Скопіюй ID у секрет Cloudflare, щоб повідомлення надходили тільки на цей iPhone.");
    } else if (Notification.permission === "denied") {
      note("Дозвіл відхилений. Дозволь сповіщення для Pillbox у налаштуваннях iPhone.");
    } else note("Натисни кнопку, щоб дозволити два типи нагадувань на iPhone.");
  }

  const appId = window.SMARTPILL_ONESIGNAL_APP_ID;
  if (!appId || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(appId)) {
    note("Спочатку встав OneSignal App ID у файл push-config.js і опублікуй сайт.");
    return;
  }
  if (!("serviceWorker" in navigator) || !("Notification" in window)) {
    note("Цей браузер не підтримує Web Push. На iPhone потрібна iOS 16.4+ і PWA на початковому екрані.");
    return;
  }
  // GitHub Pages: from https://user.github.io/repo/ -> /repo/push/onesignal/...
  const workerUrl = new URL("./push/onesignal/OneSignalSDKWorker.js", document.baseURI);
  const scopeUrl = new URL("./push/onesignal/", document.baseURI);
  const workerPath = workerUrl.pathname.replace(/^\//, "");

  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async function(os) {
    try {
      await os.init({
        appId,
        serviceWorkerPath: workerPath,
        serviceWorkerParam: { scope: scopeUrl.pathname },
        notifyButton: { enable: false },
        welcomeNotification: { disable: true }
      });
      oneSignal = os;
      if (!os.Notifications.isPushSupported()) {
        note("Для iPhone встанови сайт через «На початковий екран» та відкрий його іконкою.");
        return;
      }
      btn.disabled = false;
      os.User.PushSubscription.addEventListener("change", render);
      os.Notifications.addEventListener("permissionChange", render);
      render();
    } catch (error) {
      note("Не вдалося запустити OneSignal: " + (error?.message || "невідома помилка"));
    }
  });

  btn.addEventListener("click", async () => {
    if (!oneSignal) return;
    btn.disabled = true;
    try {
      // Initiated from a user tap — required by iOS Web Push.
      await oneSignal.Notifications.requestPermission();
      if (oneSignal.Notifications.permission) await oneSignal.User.PushSubscription.optIn();
      render();
      if (!oneSignal.User.PushSubscription.id) {
        note("Дозвіл надано. Якщо Subscription ID ще не з'явився, закрий і знову відкрий застосунок.");
        btn.disabled = false;
      }
    } catch(error) {
      note("Помилка дозволу: " + (error?.message || "спробуй ще раз"));
      btn.disabled = false;
    }
  });

  copy.addEventListener("click", async () => {
    const id = oneSignal?.User?.PushSubscription?.id;
    if (!id) return;
    try { await navigator.clipboard.writeText(id); note("Subscription ID скопійовано. Додай його у Workers & Pages → Secrets."); }
    catch { note("Скопіюй ідентифікатор вручну із поля вище."); }
  });
})();
