import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { TeacherResourcesService, TeacherResource } from '../../services/teacher-resources.service';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-teacher-resources',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './teacher-resources.component.html',
  styleUrls: ['./teacher-resources.component.css']
})
export class TeacherResourcesComponent implements OnInit {
  resources: TeacherResource[] = [];
  loading = false;
  searchTerm = '';
  selectedBatch = '';
  selectedLevel = '';
  selectedPlan = '';
  activePreviewUrl: SafeResourceUrl | null = null;
  activePreviewTitle = '';

  constructor(
    private teacherResourcesService: TeacherResourcesService,
    private sanitizer: DomSanitizer,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadResources();
  }

  get availableBatches(): string[] {
    const set = new Set(
      this.resources.map((item) => String(item.batch || '').trim()).filter((x) => x.length > 0)
    );
    return Array.from(set).sort();
  }

  get availableLevels(): string[] {
    const set = new Set(
      this.resources.map((item) => String(item.level || '').trim()).filter((x) => x.length > 0)
    );
    return Array.from(set).sort();
  }

  get availablePlans(): string[] {
    const set = new Set(
      this.resources.map((item) => String(item.plan || '').trim()).filter((x) => x.length > 0)
    );
    return Array.from(set).sort();
  }

  get filteredResources(): TeacherResource[] {
    const term = this.searchTerm.trim().toLowerCase();
    return this.resources.filter((item) => {
      if (this.selectedBatch && String(item.batch || '') !== this.selectedBatch) return false;
      if (this.selectedLevel && String(item.level || '') !== this.selectedLevel) return false;
      if (this.selectedPlan && String(item.plan || '') !== this.selectedPlan) return false;
      if (!term) return true;
      const haystack = [
        item.title,
        item.day,
        item.batch,
        item.level,
        item.plan,
        item.topic,
        item.resourceType,
        item.description,
        item.originalName
      ]
        .map((x) => String(x || '').toLowerCase())
        .join(' ');
      return haystack.includes(term);
    });
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

  resetFilters(): void {
    this.searchTerm = '';
    this.selectedBatch = '';
    this.selectedLevel = '';
    this.selectedPlan = '';
  }

  play(item: TeacherResource): void {
    const basePreviewUrl = item.previewUrl || item.fileUrl;
    const useOfficeViewer = this.teacherResourcesService.isOfficeViewerPreferred(item.originalName);
    const useDirectPreview = this.teacherResourcesService.isDirectPreviewable(item.originalName);

    if (!useOfficeViewer && !useDirectPreview) {
      this.notify.warning('Preview is not available for this file type.');
      return;
    }

    this.activePreviewTitle = item.title;
    this.activePreviewUrl = null;

    const url = useOfficeViewer
      ? this.teacherResourcesService.getOfficeViewerUrl(basePreviewUrl)
      : this.teacherResourcesService.getSecurePreviewUrl(item._id);
    this.activePreviewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  closePreview(): void {
    this.activePreviewUrl = null;
    this.activePreviewTitle = '';
  }

  async toggleFullscreen(container: HTMLElement): Promise<void> {
    try {
      if (!document.fullscreenElement) {
        await container.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      this.notify.warning('Fullscreen is not available on this browser.');
    }
  }

  getExtension(name: string): string {
    const fileName = String(name || '');
    const idx = fileName.lastIndexOf('.');
    return idx > -1 ? fileName.slice(idx + 1).toUpperCase() : 'FILE';
  }

  getFileSizeLabel(size: number | undefined): string {
    if (!size) return '-';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = size;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }
}
