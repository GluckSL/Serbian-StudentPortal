import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MaterialModule } from '../../../shared/material.module';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ClassRecordingsService, ClassRecording } from '../../../services/class-recordings.service';

@Component({
  selector: 'app-manage-recordings',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
  templateUrl: './manage-recordings.component.html',
  styleUrls: ['./manage-recordings.component.css']
})
export class ManageRecordingsComponent implements OnInit {
  recordings: ClassRecording[] = [];
  filteredRecordings: ClassRecording[] = [];
  availableBatches: string[] = [];
  levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  plans = [
    { value: 'ALL', label: 'All Plans' },
    { value: 'SILVER', label: 'Silver' },
    { value: 'PLATINUM', label: 'Platinum' }
  ];

  loading = false;
  showForm = false;
  editing: ClassRecording | null = null;

  form = { title: '', description: '', videoUrl: '', batches: [] as string[], level: 'A1', plan: 'ALL' };

  // Filters
  filterLevel = 'ALL';
  filterBatch = 'ALL';
  searchQuery = '';

  // Analytics
  analyticsSummary: Record<string, any> = {};
  showViewsModal = false;
  viewsRecording: ClassRecording | null = null;
  viewsList: any[] = [];
  loadingViews = false;

  constructor(
    private service: ClassRecordingsService,
    private snackBar: MatSnackBar,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.loadRecordings();
    this.loadBatches();
    this.loadAnalytics();
  }

  loadRecordings(): void {
    this.loading = true;
    this.service.getRecordings().subscribe({
      next: (res) => { this.recordings = res.recordings; this.applyFilters(); this.loading = false; },
      error: () => { this.snackBar.open('Error loading recordings', 'Close', { duration: 3000 }); this.loading = false; }
    });
  }

  loadBatches(): void {
    this.service.getBatches().subscribe({
      next: (res) => { this.availableBatches = res.batches; },
      error: () => {}
    });
  }

  applyFilters(): void {
    let list = [...this.recordings];
    if (this.filterLevel !== 'ALL') list = list.filter(r => r.level === this.filterLevel);
    if (this.filterBatch !== 'ALL') list = list.filter(r => r.batches.includes(this.filterBatch));
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      list = list.filter(r => r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
    }
    this.filteredRecordings = list;
  }

  openForm(recording?: ClassRecording): void {
    if (recording) {
      this.editing = recording;
      this.form = {
        title: recording.title,
        description: recording.description,
        videoUrl: recording.videoUrl,
        batches: [...recording.batches],
        level: recording.level,
        plan: recording.plan
      };
    } else {
      this.editing = null;
      this.form = { title: '', description: '', videoUrl: '', batches: [], level: 'A1', plan: 'ALL' };
    }
    this.showForm = true;
  }

  closeForm(): void { this.showForm = false; this.editing = null; }

  save(): void {
    if (!this.form.title || !this.form.videoUrl || !this.form.level || this.form.batches.length === 0) {
      this.snackBar.open('Please fill title, video URL, level, and select at least one batch', 'Close', { duration: 3000 });
      return;
    }

    const obs = this.editing
      ? this.service.update(this.editing._id, this.form)
      : this.service.create(this.form);

    obs.subscribe({
      next: () => {
        this.snackBar.open(this.editing ? 'Recording updated' : 'Recording created', 'Close', { duration: 3000 });
        this.closeForm();
        this.loadRecordings();
      },
      error: (err) => this.snackBar.open(err.error?.message || 'Error saving', 'Close', { duration: 3000 })
    });
  }

  deleteRecording(r: ClassRecording): void {
    if (!confirm(`Delete "${r.title}"?`)) return;
    this.service.delete(r._id).subscribe({
      next: () => { this.snackBar.open('Recording deleted', 'Close', { duration: 3000 }); this.loadRecordings(); },
      error: () => this.snackBar.open('Error deleting', 'Close', { duration: 3000 })
    });
  }

  getEmbedUrl(url: string): string {
    // Convert YouTube watch URLs to embed
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
    if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
    // Convert Google Drive share links to embed
    const driveMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (driveMatch) return `https://drive.google.com/file/d/${driveMatch[1]}/preview`;
    return url;
  }

  formatDate(d: string): string {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  getSafeUrl(url: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.getEmbedUrl(url));
  }

  toggleBatch(batch: string): void {
    const idx = this.form.batches.indexOf(batch);
    if (idx >= 0) this.form.batches.splice(idx, 1);
    else this.form.batches.push(batch);
  }

  loadAnalytics(): void {
    this.service.getAnalyticsSummary().subscribe({
      next: (res) => { this.analyticsSummary = res.summary; },
      error: () => {}
    });
  }

  getStats(recordingId: string): { views: number; students: number; avgTime: string } {
    const s = this.analyticsSummary[recordingId];
    if (!s) return { views: 0, students: 0, avgTime: '0s' };
    return {
      views: s.totalViews || 0,
      students: s.uniqueStudentCount || 0,
      avgTime: this.formatDuration(s.avgWatchTime || 0)
    };
  }

  openViews(r: ClassRecording): void {
    this.viewsRecording = r;
    this.loadingViews = true;
    this.showViewsModal = true;
    this.service.getViews(r._id).subscribe({
      next: (res) => { this.viewsList = res.views; this.loadingViews = false; },
      error: () => { this.loadingViews = false; }
    });
  }

  closeViews(): void { this.showViewsModal = false; this.viewsRecording = null; this.viewsList = []; }

  clearFilters(): void {
    this.searchQuery = '';
    this.filterLevel = 'ALL';
    this.filterBatch = 'ALL';
    this.applyFilters();
  }

  getTotalViews(): number {
    return Object.values(this.analyticsSummary).reduce((s: number, v: any) => s + (v.totalViews || 0), 0);
  }

  getTotalStudents(): number {
    return Object.values(this.analyticsSummary).reduce((s: number, v: any) => s + (v.uniqueStudentCount || 0), 0);
  }

  formatDuration(seconds: number): string {
    if (!seconds || seconds < 1) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.round(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  formatDateTime(d: string): string {
    return new Date(d).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }
}
