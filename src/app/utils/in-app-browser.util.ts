// utils/in-app-browser.util.ts — detect restricted in-app WebView browsers

/**
 * Returns true for social-media in-app browsers (WhatsApp, Instagram, Facebook, Telegram)
 * that cannot reliably open native app deep links or new top-level browser windows.
 * Does NOT include the Gluck app's own WebView — use isAndroidWebView() for that.
 */
export function isRestrictedInAppBrowser(): boolean {
  const ua = navigator.userAgent || '';
  // WhatsApp
  if (/\bWA(IS|BAPP)?\b/i.test(ua) || ua.includes('WhatsApp')) return true;
  // Instagram
  if (ua.includes('Instagram')) return true;
  // Facebook / Messenger
  if (/\bFBAN\b|FBAN\/|FBAV\/|FB_IAB\/|FBIOS|Messenger/i.test(ua)) return true;
  // Telegram
  if (ua.includes('Telegram') || /\bTGAndroid\b|\bTGIOS\b/i.test(ua)) return true;
  return false;
}

/**
 * Returns true when running inside a generic Android WebView (e.g. the Gluck app).
 * These WebViews cannot follow zoommtg:// but CAN open external apps via intent://.
 */
export function isAndroidWebView(): boolean {
  const ua = navigator.userAgent || '';
  return /wv\b/.test(ua) && /Android/i.test(ua);
}

/**
 * Returns true when running inside any mobile in-app WebView.
 * @deprecated Prefer isRestrictedInAppBrowser() or isAndroidWebView() for specific handling.
 */
export function isInAppBrowser(): boolean {
  return isRestrictedInAppBrowser() || isAndroidWebView();
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
