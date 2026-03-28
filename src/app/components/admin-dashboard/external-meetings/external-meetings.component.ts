import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-external-meetings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './external-meetings.component.html',
  styleUrls: ['./external-meetings.component.css']
})
export class ExternalMeetingsComponent implements OnInit {
  hosts: any[] = [];
  meetings: any[] = [];
  batches: string[] = [];
  selectedHost = '';
  dateFrom = '';
  dateTo = '';
  selectedMeeting: any = null;
  selectedBatch = '';
  selectedPlan = '';
  loadingHosts = false;
  loadingMeetings = false;
  linking = false;
  linkResult: any = null;
  error = '';

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    const today = new Date();
    const thirtyAgo = new Date(); thirtyAgo.setDate(today.getDate() - 30);
    this.dateTo = today.toISOString().split('T')[0];
    this.dateFrom = thirtyAgo.toISOString().split('T')[0];
    this.loadHosts(); this.loadBatches();
  }

  loadHosts(): void {
    this.loadingHosts = true;
    this.http.get<any>('/api/zoom/external/hosts', { withCredentials: true }).subscribe({
      next: (res) => { this.hosts = res.hosts || []; this.loadingHosts = false; },
      error: () => { this.loadingHosts = false; this.error = 'Failed to load Zoom hosts'; }
    });
  }

  loadBatches(): void {
    this.http.get<any>('/api/class-recordings/batches', { withCredentials: true }).subscribe({
      next: (res) => { this.batches = res.batches || []; },
      error: () => {}
    });
  }

  loadMeetings(): void {
    if (!this.selectedHost) { this.meetings = []; return; }
    this.loadingMeetings = true;
    this.meetings = [];
    this.selectedMeeting = null;
    this.linkResult = null;
    this.http.get<any>(`/api/zoom/external/meetings/${this.selectedHost}?from=${this.dateFrom}&to=${this.dateTo}`, { withCredentials: true }).subscribe({
      next: (res) => { this.meetings = res.meetings || []; this.loadingMeetings = false; },
      error: () => { this.loadingMeetings = false; this.error = 'Failed to load meetings'; }
    });
  }

  onHostChange(): void { this.loadMeetings(); }
  onDateChange(): void { if (this.selectedHost) this.loadMeetings(); }

  selectMeeting(m: any): void { this.selectedMeeting = m; this.linkResult = null; }

  linkMeeting(): void {
    if (!this.selectedMeeting || !this.selectedBatch) return;
    this.linking = true;
    this.error = '';
    this.linkResult = null;
    this.http.post<any>('/api/zoom/external/link', {
      zoomMeetingId: this.selectedMeeting.id,
      batch: this.selectedBatch,
      plan: this.selectedPlan || undefined,
      topic: this.selectedMeeting.topic
    }, { withCredentials: true }).subscribe({
      next: (res) => { this.linkResult = res; this.linking = false; },
      error: (err: any) => { this.error = err.error?.message || 'Failed to link meeting'; this.linking = false; }
    });
  }

  formatDate(d: string): string { return d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
  formatDuration(min: number): string { return min >= 60 ? Math.floor(min / 60) + 'h ' + (min % 60) + 'm' : min + ' min'; }
}
