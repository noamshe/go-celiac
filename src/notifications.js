// Device-local notification demo. Remote Web Push needs a server and subscription.
const enableButton = document.querySelector('#enable-notifications');
const enableLabel = enableButton.querySelector('span');
const permissionStatus = document.querySelector('#notification-permission-status');
const helpButton = document.querySelector('#test-notification');
const demoStatus = document.querySelector('#notification-demo-status');
let busy = false;

function unavailableReason() {
  if (!window.isSecureContext) return 'התראות דורשות חיבור מאובטח. פתח את האפליקציה בכתובת HTTPS כדי לנסות.';
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (ios && !installed) return 'באייפון, הוסף את האפליקציה למסך הבית ופתח אותה משם כדי לאפשר התראות (iOS 16.4 ומעלה).';
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('ServiceWorkerRegistration' in window) || !('showNotification' in ServiceWorkerRegistration.prototype)) {
    return 'הדפדפן הזה לא תומך בהתראות. אפשר להמשיך להשתמש באפליקציה כרגיל.';
  }
  return '';
}

function refreshPermission() {
  const reason = unavailableReason();
  const permission = reason ? null : Notification.permission;
  enableButton.disabled = busy || !!reason || permission === 'granted' || permission === 'denied';
  enableLabel.textContent = permission === 'granted' ? 'התראות מופעלות' : 'אפשר התראות במכשיר הזה';
  permissionStatus.textContent = reason || (permission === 'granted'
    ? 'אפשר לנסות התראת דוגמה במסך ״עוזרים לקהילה״.'
    : permission === 'denied'
      ? 'התראות חסומות. אפשר לשנות זאת בהגדרות ההתראות של הדפדפן או המכשיר.'
      : 'לא חובה — אפשר להמשיך גם בלי התראות.');
}

async function requestPermission(status) {
  const reason = unavailableReason();
  if (reason) { status.textContent = reason; return false; }
  // Call directly from the click handler, before awaiting any worker setup.
  const permission = Notification.permission === 'default'
    ? await Notification.requestPermission()
    : Notification.permission;
  refreshPermission();
  if (permission !== 'granted') {
    status.textContent = permission === 'denied'
      ? 'התראות חסומות. אפשר לאפשר אותן בהגדרות ההתראות של הדפדפן או המכשיר.'
      : 'לא ניתנה הרשאה להתראות. אפשר לנסות שוב כשיתאים לך.';
    return false;
  }
  return true;
}

async function withNotificationAction(button, status, action) {
  if (busy) return;
  busy = true;
  button.setAttribute('aria-busy', 'true');
  button.disabled = true;
  try {
    await action();
  } catch {
    status.textContent = 'לא הצלחנו להפעיל את ההתראה. בדוק את הרשאות המכשיר ונסה שוב.';
  } finally {
    busy = false;
    button.removeAttribute('aria-busy');
    button.disabled = false;
    // Preserve feedback from this action while updating the button state.
    const feedback = status.textContent;
    refreshPermission();
    status.textContent = feedback;
  }
}

enableButton.addEventListener('click', () => {
  void withNotificationAction(enableButton, permissionStatus, async () => {
    if (await requestPermission(permissionStatus)) permissionStatus.textContent = 'התראות מופעלות. אפשר לנסות התראת דוגמה במסך ״עוזרים לקהילה״.';
  });
});

helpButton.addEventListener('click', () => {
  void withNotificationAction(helpButton, demoStatus, async () => {
    if (!(await requestPermission(demoStatus))) return;
    demoStatus.textContent = 'מכינים התראת דוגמה…';
    await navigator.serviceWorker.register('/sw.js');
    let timeout;
    try {
      const ready = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Worker not ready')), 10000); }),
      ]);
      await ready.showNotification('ביחד · הקהילה צריכה אותך', {
        body: 'התראת דוגמה: 3 שאלות מחכות לעזרה שלך. לחץ כדי לפתוח שאלה מהקהילה.',
        icon: '/icons/icon-192.png',
        tag: 'beyachad-help-demo',
        lang: 'he',
        dir: 'rtl',
      });
      demoStatus.textContent = 'התראת הדוגמה הופעלה במכשיר הזה. בדוק את מרכז ההתראות.';
    } finally {
      clearTimeout(timeout);
    }
  });
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !busy) refreshPermission();
});
refreshPermission();
