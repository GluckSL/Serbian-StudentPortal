import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { TeacherResourcesService, TeacherResource } from '../../services/teacher-resources.service';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-teacher-resources',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './teacher-resources.component.html',
  styleUrls: ['./teacher-resources.component.css']
})
export class TeacherResourcesComponent implements OnInit {
  resources: TeacherResource[] = [];
  loading = false;
  activePreviewUrl: SafeResourceUrl | null = null;
  activePreviewTitle = '';
  activePreviewHtml: string | null = null;

  constructor(
    private teacherResourcesService: TeacherResourcesService,
    private http: HttpClient,
    private sanitizer: DomSanitizer,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadResources();
  }

  loadResources(): void {
    this.loading = true;
    this.teacherResourcesService.list().subscribe({
      next: (res) => {
        this.resources = res?.data || [];
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.notify.error('Failed to load resources');
      }
    });
  }

  play(item: TeacherResource): void {
    const basePreviewUrl = item.previewUrl || item.fileUrl;
    const useOfficeViewer = this.teacherResourcesService.isOfficeViewerPreferred(item.originalName);
    const useDirectPreview = this.teacherResourcesService.isDirectPreviewable(item.originalName);
    const isHtml = /\.html?$/i.test(item.originalName || '');

    if (!useOfficeViewer && !useDirectPreview) {
      this.notify.warning('Preview is not available for this file type.');
      return;
    }

    this.activePreviewTitle = item.title;
    this.activePreviewUrl = null;
    this.activePreviewHtml = null;

    if (isHtml) {
      const previewUrl = this.teacherResourcesService.getSecurePreviewUrl(item._id);
      this.http.get(previewUrl, { responseType: 'text', withCredentials: true }).subscribe({
        next: (html) => {
          this.activePreviewHtml = html || '<p>No preview content.</p>';
        },
        error: () => {
          this.notify.error('Failed to load HTML preview.');
        }
      });
      return;
    }

    const url = useOfficeViewer
      ? this.teacherResourcesService.getOfficeViewerUrl(basePreviewUrl)
      : this.teacherResourcesService.getSecurePreviewUrl(item._id);
    this.activePreviewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  closePreview(): void {
    this.activePreviewUrl = null;
    this.activePreviewHtml = null;
    this.activePreviewTitle = '';
  }

  getExtension(name: string): string {
    const fileName = String(name || '');
    const idx = fileName.lastIndexOf('.');
    return idx > -1 ? fileName.slice(idx + 1).toUpperCase() : 'FILE';
  }
}
