// utils/in-app-browser.util.ts — detect restricted in-app WebView browsers

/** Returns true when running inside a mobile in-app WebView that cannot reliably open
 *  native app deep links or create new top-level browser windows. */
export function isInAppBrowser(): boolean {
  const ua = navigator.userAgent || '';
  // WhatsApp: WAIS; WHATSAPP in UA
  if (/\bWA(IS|BAPP)?\b/i.test(ua) || ua.includes('WhatsApp')) return true;
  // Instagram
  if (ua.includes('Instagram')) return true;
  // Facebook / Messenger
  if (/\bFBAN\b|FBAN\/|FBAV\/|FB_IAB\/|FBIOS|Messenger/i.test(ua)) return true;
  // Telegram
  if (ua.includes('Telegram') || /\bTGAndroid\b|\bTGIOS\b/i.test(ua)) return true;
  // Generic Android WebView (may also catch other in-app browsers)
  if (/wv\b/.test(ua) && /Android/i.test(ua)) return true;
  return false;
}

/** Returns true on Android or iOS. */
export function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** Returns 'android' | 'ios' | 'desktop'. */
export function deviceType(): 'android' | 'ios' | 'desktop' {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  return 'desktop';
}
