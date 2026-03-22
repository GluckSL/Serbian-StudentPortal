import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MaterialModule } from '../../../shared/material.module';
import { ClassRecordingsService, ClassRecording } from '../../../services/class-recordings.service';

@Component({
  selector: 'app-student-recordings',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
  templateUrl: './student-recordings.component.html',
  styleUrls: ['./student-recordings.component.css']
})
export class StudentRecordingsComponent implements OnInit, OnDestroy {
  recordings: ClassRecording[] = [];
  filteredRecordings: ClassRecording[] = [];
  loading = false;
  searchQuery = '';

  // View tracking
  activeViewId: string | null = null;
  activeRecordingId: string | null = null;
  watchStartTime = 0;
  private durationInterval: any = null;

  constructor(
    private service: ClassRecordingsService,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.loading = true;
    this.service.getRecordings().subscribe({
      next: (res) => { this.recordings = res.recordings; this.filteredRecordings = [...this.recordings]; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  ngOnDestroy(): void {
    this.stopTracking();
  }

  startWatching(recordingId: string): void {
    // If already tracking this recording, ignore
    if (this.activeRecordingId === recordingId) return;
    // Stop previous tracking if any
    this.stopTracking();

    this.activeRecordingId = recordingId;
    this.watchStartTime = Date.now();

    this.service.startView(recordingId).subscribe({
      next: (res) => {
        this.activeViewId = res.viewId;
        // Update duration every 15 seconds
        this.durationInterval = setInterval(() => this.updateDuration(), 15000);
      },
      error: () => {}
    });
  }

  private updateDuration(): void {
    if (!this.activeViewId) return;
    const seconds = Math.round((Date.now() - this.watchStartTime) / 1000);
    this.service.updateViewDuration(this.activeViewId, seconds).subscribe({ error: () => {} });
  }

  private stopTracking(): void {
    if (this.activeViewId) {
      this.updateDuration(); // final update
    }
    if (this.durationInterval) { clearInterval(this.durationInterval); this.durationInterval = null; }
    this.activeViewId = null;
    this.activeRecordingId = null;
  }

  applySearch(): void {
    if (!this.searchQuery.trim()) { this.filteredRecordings = [...this.recordings]; return; }
    const q = this.searchQuery.toLowerCase();
    this.filteredRecordings = this.recordings.filter(r =>
      r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)
    );
  }

  getEmbedUrl(url: string): string {
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
    if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
    const driveMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (driveMatch) return `https://drive.google.com/file/d/${driveMatch[1]}/preview`;
    return url;
  }

  isGoogleDrive(url: string): boolean {
    return /drive\.google\.com/.test(url);
  }

  getGoogleDriveOpenUrl(url: string): string {
    const match = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return `https://drive.google.com/file/d/${match[1]}/view`;
    return url;
  }

  openInNewTab(url: string): void {
    window.open(this.getGoogleDriveOpenUrl(url), '_blank');
  }

  getSafeUrl(url: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.getEmbedUrl(url));
  }

  formatDate(d: string): string {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
