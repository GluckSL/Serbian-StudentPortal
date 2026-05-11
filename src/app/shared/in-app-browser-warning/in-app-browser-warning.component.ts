import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface InAppBrowserWarningData {
  /** The Zoom web URL to launch after the user copies/opens in a system browser. */
  zoomWebUrl: string;
}

/**
 * Warning dialog shown when the portal detects it is running inside a
 * restricted in-app browser (WhatsApp, Instagram, Facebook, Telegram).
 *
 * The user can either:
 * (A) Follow the "Open in browser" instructions manually, OR
 * (B) Click "Open Browser" to attempt a best-effort system-browser launch
 *     (works reliably on Android with intent:// and on some iOS configs).
 *
 * After either action the caller proceeds with the normal Zoom join.
 */
@Component({
  selector: 'app-in-app-browser-warning',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="iab-warning-dialog">
      <div class="iab-header">
        <mat-icon class="iab-icon">warning_amber</mat-icon>
        <h2 mat-dialog-title>Open in Chrome, Safari, or Zoom</h2>
      </div>

      <mat-dialog-content>
        <p>
          Please open in Chrome/Safari or Zoom App for proper class joining and attendance tracking.
        </p>
        <p><strong>To join correctly:</strong></p>
        <ol>
          <li>Tap the <strong>⋮ menu</strong> (Android) or <strong>Share button</strong> (iPhone)</li>
          <li>Choose <strong>"Open in Chrome"</strong> or <strong>"Open in Safari"</strong></li>
          <li>Then tap the Join button again on the portal</li>
        </ol>
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-stroked-button (click)="dismiss()">Continue anyway</button>
        <button mat-flat-button color="primary" (click)="openInBrowser()">
          Open in Browser
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .iab-warning-dialog { padding: 8px; max-width: 420px; }
    .iab-header { display: flex; align-items: center; gap: 10px; }
    .iab-icon { color: #f59e0b; font-size: 28px; width: 28px; height: 28px; }
    h2[mat-dialog-title] { margin: 0; font-size: 18px; }
    mat-dialog-content p, mat-dialog-content ol { font-size: 14px; line-height: 1.6; }
    mat-dialog-content ol { padding-left: 20px; }
    mat-dialog-actions { margin-top: 8px; gap: 8px; }
  `],
})
export class InAppBrowserWarningComponent {
  constructor(
    private dialogRef: MatDialogRef<InAppBrowserWarningComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: InAppBrowserWarningData,
  ) {}

  dismiss(): void {
    this.dialogRef.close(false);
  }

  openInBrowser(): void {
    const url = this.data.zoomWebUrl;
    if (!url) { this.dialogRef.close(true); return; }

    // Android: try intent:// URI to force the default browser.
    // iOS: window.open is the best available option from a WebView.
    // Both cases fall back gracefully if the intent scheme is unsupported.
    const ua = navigator.userAgent;
    if (/Android/i.test(ua)) {
      // intent:// opens the URL in the Android default browser from within a WebView.
      const intentUrl =
        'intent://' +
        url.replace(/^https?:\/\//, '') +
        '#Intent;scheme=https;package=com.android.chrome;end';
      window.location.href = intentUrl;
    } else {
      // iOS / desktop: best-effort new tab.
      window.open(url, '_blank');
    }
    this.dialogRef.close(true);
  }
}
