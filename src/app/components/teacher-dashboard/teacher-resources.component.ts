import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { TeacherResourcesService, TeacherResource, ResourceGroup } from '../../services/teacher-resources.service';
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
  filterBatches: string[] = [];
  filterLevels: string[] = [];
  filterPlans: string[] = [];
  activePreviewUrl: SafeResourceUrl | null = null;
  activePreviewRawUrl = '';
  activePreviewTitle = '';
  activePreviewIsAudio = false;
  activePreviewIsVideo = false;
  activePreviewGroupFiles: TeacherResource[] = [];
  activePreviewFileIndex = 0;

  constructor(
    public teacherResourcesService: TeacherResourcesService,
    private sanitizer: DomSanitizer,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadResources();
  }

  get availableBatches(): string[] {
    if (this.filterBatches.length > 0) return this.filterBatches;
    const set = new Set(this.resources.map((item) => String(item.batch || '').trim()).filter((x) => x.length > 0));
    return Array.from(set).sort();
  }

  get availableLevels(): string[] {
    if (this.filterLevels.length > 0) return this.filterLevels;
    const set = new Set(this.resources.map((item) => String(item.level || '').trim()).filter((x) => x.length > 0));
    return Array.from(set).sort();
  }

  get availablePlans(): string[] {
    if (this.filterPlans.length > 0) return this.filterPlans;
    const set = new Set(this.resources.map((item) => String(item.plan || '').trim()).filter((x) => x.length > 0));
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

  get groupedResources(): ResourceGroup[] {
    const map = new Map<string, TeacherResource[]>();
    for (const item of this.filteredResources) {
      const assigneeKey = this.assignedTeacherIdStrings(item).sort().join(',');
      const key = `${assigneeKey}||${String(item.title || '').trim()}||${String(item.day || '').trim()}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries()).map(([key, files]) => {
      const first = files[0];
      return {
        groupKey: key,
        title: first.title,
        day: first.day,
        batch: first.batch || '',
        level: first.level || '',
        plan: first.plan || '',
        resourceType: first.resourceType || '',
        topic: first.topic || '',
        description: first.description || '',
        uploadedAt: first.uploadedAt,
        files,
        activeFileIndex: 0
      };
    });
  }

  loadResources(): void {
    this.loading = true;
    this.teacherResourcesService.list().subscribe({
      next: (res) => {
        this.resources = res?.data || [];
        this.filterBatches = Array.isArray(res?.filters?.batches) ? res.filters.batches : [];
        this.filterLevels = Array.isArray(res?.filters?.levels) ? res.filters.levels : [];
        this.filterPlans = Array.isArray(res?.filters?.plans) ? res.filters.plans : [];
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

  play(group: ResourceGroup, fileIndex = 0): void {
    this.activePreviewGroupFiles = group.files;
    this.activePreviewFileIndex = fileIndex;
    this.activePreviewTitle = group.title;
    this.loadFileIntoPreview(group.files[fileIndex]);
  }

  switchFile(index: number): void {
    this.activePreviewFileIndex = index;
    this.loadFileIntoPreview(this.activePreviewGroupFiles[index]);
  }

  private loadFileIntoPreview(item: TeacherResource): void {
    const basePreviewUrl = item.previewUrl || item.fileUrl;
    const useOfficeViewer = this.teacherResourcesService.isOfficeViewerPreferred(item.originalName);
    const useDirectPreview = this.teacherResourcesService.isDirectPreviewable(item.originalName);

    if (!useOfficeViewer && !useDirectPreview) {
      this.notify.warning('Preview is not available for this file type.');
      return;
    }

    this.activePreviewUrl = null;
    this.activePreviewRawUrl = '';
    this.activePreviewIsAudio = this.teacherResourcesService.isAudioFile(item.originalName);
    this.activePreviewIsVideo = this.teacherResourcesService.isVideoFile(item.originalName);

    let url: string;
    if (useOfficeViewer) {
      url = this.teacherResourcesService.getOfficeViewerUrl(basePreviewUrl);
    } else if (this.teacherResourcesService.requiresApiProxy(item.originalName)) {
      url = this.teacherResourcesService.getSecurePreviewUrl(item._id);
    } else if (basePreviewUrl) {
      url = basePreviewUrl;
    } else {
      url = this.teacherResourcesService.getSecurePreviewUrl(item._id);
    }

    this.activePreviewRawUrl = url;
    this.activePreviewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  closePreview(): void {
    this.activePreviewUrl = null;
    this.activePreviewRawUrl = '';
    this.activePreviewTitle = '';
    this.activePreviewIsAudio = false;
    this.activePreviewIsVideo = false;
    this.activePreviewGroupFiles = [];
    this.activePreviewFileIndex = 0;
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

  private assignedTeacherIdStrings(item: TeacherResource): string[] {
    const ids: string[] = [];
    const raw = item.teacherIds;
    if (Array.isArray(raw) && raw.length > 0) {
      for (const t of raw) {
        if (typeof t === 'object' && t && '_id' in t) ids.push(String((t as { _id: string })._id));
        else if (t) ids.push(String(t));
      }
      return [...new Set(ids)];
    }
    const tid = item.teacherId;
    if (typeof tid === 'object' && tid && '_id' in tid) return [String((tid as { _id: string })._id)];
    if (tid) return [String(tid)];
    return [];
  }
}
