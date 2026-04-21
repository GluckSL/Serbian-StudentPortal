import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { TeacherService } from '../../services/teacher.service';
import { TeacherResourcesService, TeacherResource } from '../../services/teacher-resources.service';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-teacher-resources-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './teacher-resources-admin.component.html',
  styleUrls: ['./teacher-resources-admin.component.css']
})
export class TeacherResourcesAdminComponent implements OnInit {
  teachers: any[] = [];
  resources: TeacherResource[] = [];
  selectedTeacherId = '';
  title = '';
  day = '';
  file: File | null = null;
  selectedFileName = 'No file chosen';
  uploading = false;
  loading = false;
  activePreviewUrl: SafeResourceUrl | null = null;
  activePreviewTitle = '';

  constructor(
    private teacherService: TeacherService,
    private teacherResourcesService: TeacherResourcesService,
    private sanitizer: DomSanitizer,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadTeachers();
    this.loadResources();
  }

  loadTeachers(): void {
    this.teacherService.getAllTeachers().subscribe({
      next: (res) => (this.teachers = res?.data || []),
      error: () => this.notify.error('Failed to load teachers')
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

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = input.files?.[0] || null;
    this.file = picked;
    this.selectedFileName = picked ? picked.name : 'No file chosen';
  }

  upload(): void {
    if (!this.selectedTeacherId || !this.title.trim() || !this.day.trim() || !this.file) {
      this.notify.warning('Please select teacher, title, day and file');
      return;
    }

    this.uploading = true;
    this.teacherResourcesService
      .upload({
        teacherId: this.selectedTeacherId,
        title: this.title.trim(),
        day: this.day.trim(),
        file: this.file
      })
      .subscribe({
        next: () => {
          this.uploading = false;
          this.notify.success('Resource uploaded');
          this.title = '';
          this.day = '';
          this.file = null;
          this.selectedFileName = 'No file chosen';
          this.loadResources();
        },
        error: (err) => {
          this.uploading = false;
          this.notify.error(err?.error?.message || 'Upload failed');
        }
      });
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

  delete(item: TeacherResource): void {
    this.teacherResourcesService.delete(item._id).subscribe({
      next: () => {
        this.notify.success('Resource deleted');
        this.loadResources();
      },
      error: () => this.notify.error('Delete failed')
    });
  }

  teacherName(item: TeacherResource): string {
    const t = item.teacherId as any;
    return typeof t === 'object' ? t.name : 'Teacher';
  }

  getFileSizeLabel(size: number | undefined): string {
    if (!size) return 'Unknown size';
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
