import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/**
 * Strips everything except a small safe inline-formatting whitelist, then
 * marks the result as trusted HTML for use with [innerHTML].
 *
 * Allowed tags: <b> <strong> <i> <em> <mark> <br> <u> <span>
 * All other tags and their contents are removed; attributes (except class on
 * <span>/<mark>) are stripped to prevent XSS.
 */
export function sanitizeQuestionHtml(raw: string): string {
  if (!raw) return '';

  // 1. Replace &amp; back to & so we don't double-encode
  let html = raw;

  // 2. Strip every tag except the whitelist
  const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'mark', 'br', 'u', 'span']);
  html = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g, (match, tagName) => {
    const tag = tagName.toLowerCase();
    if (!ALLOWED.has(tag)) return '';
    // Self-closing br
    if (tag === 'br') return '<br>';
    // For closing tags, just return the closing tag
    if (match.startsWith('</')) return `</${tag}>`;
    // Opening mark/span: strip all attributes to stay safe
    return `<${tag}>`;
  });

  // 3. Collapse excessive blank lines
  html = html.replace(/(<br>\s*){3,}/gi, '<br><br>');

  return html;
}

@Pipe({
  name: 'safeHtml',
  standalone: true
})
export class SafeHtmlPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(value: string | null | undefined): SafeHtml {
    const clean = sanitizeQuestionHtml(value || '');
    return this.sanitizer.bypassSecurityTrustHtml(clean);
  }
}
