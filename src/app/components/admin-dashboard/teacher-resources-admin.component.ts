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
  batch = '';
  level = '';
  plan = '';
  resourceType = '';
  topic = '';
  description = '';
  file: File | null = null;
  selectedFileName = 'No file chosen';
  uploading = false;
  loading = false;
  searchTerm = '';
  filterTeacherId = '';
  filterBatch = '';
  filterLevel = '';
  filterPlan = '';
  activePreviewUrl: SafeResourceUrl | null = null;
  activePreviewTitle = '';
  editingResourceId = '';
  editTeacherId = '';
  editTitle = '';
  editDay = '';
  editBatch = '';
  editLevel = '';
  editPlan = '';
  editResourceType = '';
  editTopic = '';
  editDescription = '';
  editFile: File | null = null;
  editSelectedFileName = '';
  savingEdit = false;

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

  get filteredResources(): TeacherResource[] {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) return this.resources;
    return this.resources.filter((item) => {
      const teacher = this.teacherName(item).toLowerCase();
      const haystack = [
        item.title,
        item.day,
        item.batch,
        item.level,
        item.plan,
        item.topic,
        item.resourceType,
        item.description,
        item.originalName,
        teacher
      ]
        .map((x) => String(x || '').toLowerCase())
        .join(' ');
      return haystack.includes(term);
    });
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

  loadTeachers(): void {
    this.teacherService.getAllTeachers().subscribe({
      next: (res) => (this.teachers = res?.data || []),
      error: () => this.notify.error('Failed to load teachers')
    });
  }

  loadResources(): void {
    this.loading = true;
    this.teacherResourcesService
      .list({
        teacherId: this.filterTeacherId || undefined,
        batch: this.filterBatch || undefined,
        level: this.filterLevel || undefined,
        plan: this.filterPlan || undefined
      })
      .subscribe({
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
        batch: this.batch.trim(),
        level: this.level.trim(),
        plan: this.plan.trim(),
        resourceType: this.resourceType.trim(),
        topic: this.topic.trim(),
        description: this.description.trim(),
        file: this.file
      })
      .subscribe({
        next: () => {
          this.uploading = false;
          this.notify.success('Resource uploaded');
          this.title = '';
          this.day = '';
          this.batch = '';
          this.level = '';
          this.plan = '';
          this.resourceType = '';
          this.topic = '';
          this.description = '';
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
    if (!confirm(`Delete resource "${item.title}"?`)) return;
    this.teacherResourcesService.delete(item._id).subscribe({
      next: () => {
        this.notify.success('Resource deleted');
        this.loadResources();
      },
      error: () => this.notify.error('Delete failed')
    });
  }

  startEdit(item: TeacherResource): void {
    this.editingResourceId = item._id;
    this.editTeacherId = this.teacherIdValue(item.teacherId);
    this.editTitle = item.title || '';
    this.editDay = item.day || '';
    this.editBatch = item.batch || '';
    this.editLevel = item.level || '';
    this.editPlan = item.plan || '';
    this.editResourceType = item.resourceType || '';
    this.editTopic = item.topic || '';
    this.editDescription = item.description || '';
    this.editFile = null;
    this.editSelectedFileName = '';
  }

  cancelEdit(): void {
    this.editingResourceId = '';
    this.editTeacherId = '';
    this.editTitle = '';
    this.editDay = '';
    this.editBatch = '';
    this.editLevel = '';
    this.editPlan = '';
    this.editResourceType = '';
    this.editTopic = '';
    this.editDescription = '';
    this.editFile = null;
    this.editSelectedFileName = '';
    this.savingEdit = false;
  }

  onEditFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = input.files?.[0] || null;
    this.editFile = picked;
    this.editSelectedFileName = picked ? picked.name : '';
  }

  saveEdit(): void {
    if (!this.editingResourceId) return;
    if (!this.editTeacherId || !this.editTitle.trim() || !this.editDay.trim()) {
      this.notify.warning('Teacher, title and day are required');
      return;
    }
    this.savingEdit = true;
    this.teacherResourcesService
      .update(this.editingResourceId, {
        teacherId: this.editTeacherId.trim(),
        title: this.editTitle.trim(),
        day: this.editDay.trim(),
        batch: this.editBatch.trim(),
        level: this.editLevel.trim(),
        plan: this.editPlan.trim(),
        resourceType: this.editResourceType.trim(),
        topic: this.editTopic.trim(),
        description: this.editDescription.trim(),
        file: this.editFile
      })
      .subscribe({
        next: () => {
          this.savingEdit = false;
          this.notify.success('Resource updated');
          this.cancelEdit();
          this.loadResources();
        },
        error: (err) => {
          this.savingEdit = false;
          this.notify.error(err?.error?.message || 'Update failed');
        }
      });
  }

  teacherName(item: TeacherResource): string {
    const t = item.teacherId as any;
    return typeof t === 'object' ? t.name : 'Teacher';
  }

  teacherIdValue(value: TeacherResource['teacherId']): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    return value._id || '';
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

  clearFilters(): void {
    this.searchTerm = '';
    this.filterTeacherId = '';
    this.filterBatch = '';
    this.filterLevel = '';
    this.filterPlan = '';
    this.loadResources();
  }
}
