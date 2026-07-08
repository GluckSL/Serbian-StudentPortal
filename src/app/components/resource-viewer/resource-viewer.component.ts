import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { environment } from '../../../environments/environment';
import { getAuthToken } from '../../services/auth.service';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs';

type ViewerType = 'pdf' | 'image' | 'audio' | 'video' | 'text' | 'pptx' | 'unsupported';

@Component({
  selector: 'app-resource-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './resource-viewer.component.html',
  styleUrls: ['./resource-viewer.component.scss']
})
export class ResourceViewerComponent implements OnDestroy {
  @Input() set resource(r: any) {
    this._resource = r;
    if (r && this._visible) this.open();
  }
  get resource(): any { return this._resource; }
  private _resource: any = null;

  @Input() set visible(v: boolean) {
    this._visible = v;
    if (v && this._resource) this.open();
    if (!v) this.cleanup();
  }
  get visible(): boolean { return this._visible; }
  private _visible = false;

  @Output() closed = new EventEmitter<void>();

  @ViewChild('pdfContainer') pdfContainer!: ElementRef;

  type: ViewerType = 'unsupported';
  url: string | null = null;
  safeUrl: SafeResourceUrl | null = null;
  pptxViewerUrl: SafeResourceUrl | null = null;
  loading = false;
  loaded = false;
  error: string | null = null;

  pdfDoc: any = null;
  currentPage = 1;
  totalPages = 0;
  private renderingPage = 0;

  constructor(
    private http: HttpClient,
    private sanitizer: DomSanitizer
  ) {}

  @HostListener('contextmenu', ['$event'])
  onContextMenu(event: MouseEvent): void {
    if (this.type === 'image' || this.type === 'pdf' || this.type === 'pptx' || this.type === 'audio' || this.type === 'video') {
      event.preventDefault();
    }
  }

  private detectType(): ViewerType {
    const name = (this._resource?.originalName || '').toLowerCase();
    const mime = (this._resource?.mimeType || '').toLowerCase();
    if (mime.startsWith('image/') || /\.(jpe?g|png|gif|webp|svg|bmp|ico)$/.test(name)) return 'image';
    if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|wma|flac)$/.test(name)) return 'audio';
    if (mime.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv|wmv)$/.test(name)) return 'video';
    if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    if (name.endsWith('.pptx') || mime.includes('presentationml')) return 'pptx';
    if (mime.startsWith('text/') || /\.(txt|csv|html?|xml|json|md)$/.test(name)) return 'text';
    return 'unsupported';
  }

  private async open(): Promise<void> {
    this.cleanup();
    this.loading = true;
    this.loaded = false;
    this.error = null;
    this.type = this.detectType();

    if (this.type === 'unsupported') {
      this.loading = false;
      return;
    }

    const id = this._resource?._id || '';
    if (!id) {
      this.url = this._resource?.fileUrl || null;
      if (!this.url) { this.error = 'No URL available'; this.loading = false; return; }
      this.safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.url);
      await this.renderByType();
      return;
    }

    this.http.get<{ success?: boolean; url?: string; mode?: string }>(
      `${environment.apiUrl}/class-resources/view/${id}`,
      { withCredentials: true }
    ).subscribe({
      next: async (res) => {
        if (!res?.url) { this.error = 'Failed to get view URL'; this.loading = false; return; }
        this.url = res.url;
        this.safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.url);
        await this.renderByType();
      },
      error: () => { this.error = 'Failed to load file'; this.loading = false; }
    });
  }

  private async renderByType(): Promise<void> {
    if (this.type === 'pdf') await this.renderPdf();
    else if (this.type === 'pptx') await this.renderPptx();
    else this.loaded = true;
    this.loading = false;
  }

  private async renderPdf(): Promise<void> {
    try {
      const id = this._resource?._id || '';
      let data: ArrayBuffer;
      if (id) {
        const url = `${environment.apiUrl}/class-resources/${id}/file`;
        const resp = await fetch(url, { headers: this.authHeaders() });
        if (!resp.ok) throw new Error(`Failed to fetch PDF (${resp.status})`);
        data = await resp.arrayBuffer();
      } else if (this.url) {
        data = await fetch(this.url).then(r => {
          if (!r.ok) throw new Error(`Failed to fetch PDF (${r.status})`);
          return r.arrayBuffer();
        });
      } else {
        throw new Error('No URL or ID available');
      }
      this.pdfDoc = await getDocument({ data }).promise;
      this.totalPages = this.pdfDoc.numPages;
      this.currentPage = 1;
      this.loaded = true;
      this.loading = false;
      setTimeout(() => this.renderPdfPage(1), 0);
    } catch (e: any) {
      this.error = e?.message || 'Failed to render PDF';
      this.loading = false;
    }
  }

  private async renderPdfPage(pageNum: number): Promise<void> {
    if (!this.pdfDoc || !this.pdfContainer) return;
    this.renderingPage = pageNum;
    const page = await this.pdfDoc.getPage(pageNum);
    if (this.renderingPage !== pageNum) return;
    const container = this.pdfContainer.nativeElement;
    const pad = 16;
    const availWidth = container.clientWidth - pad;
    const availHeight = container.clientHeight - pad;
    if (availWidth <= 0 || availHeight <= 0) return;
    const base = page.getViewport({ scale: 1 });
    const displayScale = Math.min(availWidth / base.width, availHeight / base.height, 2);
    if (displayScale <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = base.width * displayScale;
    const displayHeight = base.height * displayScale;
    const viewport = page.getViewport({ scale: displayScale * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
    if (this.renderingPage !== pageNum) return;
    this.pdfContainer.nativeElement.innerHTML = '';
    this.pdfContainer.nativeElement.appendChild(canvas);
    const ctx = canvas.getContext('2d')!;
    try {
      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch {
      if (this.renderingPage === pageNum) {
        this.error = `Failed to render page ${pageNum}`;
      }
    }
  }

  prevPdfPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.error = null;
      this.renderPdfPage(this.currentPage);
    }
  }

  nextPdfPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.error = null;
      this.renderPdfPage(this.currentPage);
    }
  }

  private authHeaders(): Record<string, string> {
    const token = getAuthToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async renderPptx(): Promise<void> {
    if (!this.url) { this.error = 'No URL available'; this.loading = false; return; }
    const msUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(this.url)}&wdDownloadButton=0&wdPrintButton=0`;
    this.pptxViewerUrl = this.sanitizer.bypassSecurityTrustResourceUrl(msUrl);
    this.loaded = true;
  }

  close(): void {
    this.closed.emit();
  }

  private cleanup(): void {
    if (this.pdfDoc?.destroy) this.pdfDoc.destroy();
    this.pdfDoc = null;
    this.url = null;
    this.safeUrl = null;
    this.pptxViewerUrl = null;
    this.loaded = false;
    this.loading = false;
    this.error = null;
    this.currentPage = 1;
    this.totalPages = 0;
  }

  ngOnDestroy(): void {
    this.cleanup();
  }
}
