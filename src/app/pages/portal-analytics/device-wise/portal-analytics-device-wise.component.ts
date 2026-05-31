import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { PortalAnalyticsApiService, PortalAnalyticsRange } from '../../../services/portal-analytics-api.service';
import { formatPortalDuration } from '../portal-analytics-format';

export interface DeviceWiseRow {
  studentId: string;
  studentName: string;
  email: string;
  deviceType: string;
  os: string;
  browser: string;
  deviceLabel: string;
  totalSeconds: number;
  sessionsCount: number;
  lastSeenAt: string | null;
}

interface StudentDeviceRow {
  studentId: string;
  studentName: string;
  email: string;
  deviceType: string;
  totalSeconds: number;
  sessionsCount: number;
  lastSeenAt: string | null;
}

@Component({
  selector: 'app-portal-analytics-device-wise',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule, MatButtonModule],
  templateUrl: './portal-analytics-device-wise.component.html',
  styleUrls: ['./portal-analytics-device-wise.component.scss']
})
export class PortalAnalyticsDeviceWiseComponent implements OnChanges {
  @Input({ required: true }) range!: PortalAnalyticsRange;

  readonly pageSize = 12;
  loading = false;
  error = '';
  rows: StudentDeviceRow[] = [];
  currentPage = 1;

  constructor(private api: PortalAnalyticsApiService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['range'] && this.range?.from && this.range?.to) {
      this.load();
    }
  }

  formatDuration = formatPortalDuration;

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.rows.length / this.pageSize));
  }

  get pagedRows(): StudentDeviceRow[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.rows.slice(start, start + this.pageSize);
  }

  get mobileCount(): number {
    return this.rows.filter((r) => r.deviceType === 'Mobile').length;
  }

  get laptopCount(): number {
    return this.rows.filter((r) => r.deviceType === 'Laptop').length;
  }

  get tabletCount(): number {
    return this.rows.filter((r) => r.deviceType === 'Tablet').length;
  }

  prevPage(): void {
    if (this.currentPage <= 1) return;
    this.currentPage--;
  }

  nextPage(): void {
    if (this.currentPage >= this.totalPages) return;
    this.currentPage++;
  }

  private load(): void {
    this.loading = true;
    this.error = '';
    this.api.getDeviceWise(this.range, 400).subscribe({
      next: (res: unknown) => {
        const body = res as { items?: DeviceWiseRow[] };
        this.rows = this.toStudentPrimaryDeviceRows(body.items || []);
        this.currentPage = 1;
        this.loading = false;
      },
      error: () => {
        this.error = 'Could not load device data.';
        this.loading = false;
      }
    });
  }

  private normalizeDeviceType(raw: string): 'Mobile' | 'Laptop' | 'Tablet' | 'Unknown' {
    const value = String(raw || '').toLowerCase();
    if (value === 'mobile') return 'Mobile';
    if (value === 'tablet') return 'Tablet';
    if (value === 'desktop') return 'Laptop';
    return 'Unknown';
  }

  private toStudentPrimaryDeviceRows(rows: DeviceWiseRow[]): StudentDeviceRow[] {
    const grouped = new Map<string, StudentDeviceRow[]>();
    for (const row of rows) {
      const key = String(row.studentId || '').trim();
      if (!key) continue;
      const normalized: StudentDeviceRow = {
        studentId: key,
        studentName: row.studentName || 'Unknown',
        email: row.email || '',
        deviceType: this.normalizeDeviceType(row.deviceType),
        totalSeconds: Math.max(0, Number(row.totalSeconds) || 0),
        sessionsCount: Math.max(0, Number(row.sessionsCount) || 0),
        lastSeenAt: row.lastSeenAt || null
      };
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(normalized);
    }

    const result: StudentDeviceRow[] = [];
    for (const [, variants] of grouped) {
      const nonUnknown = variants.filter((v) => v.deviceType !== 'Unknown');
      const source = nonUnknown.length ? nonUnknown : variants;
      source.sort((a, b) => b.totalSeconds - a.totalSeconds);
      const primary = source[0];

      const totalSeconds = variants.reduce((sum, v) => sum + v.totalSeconds, 0);
      const sessionsCount = variants.reduce((sum, v) => sum + v.sessionsCount, 0);
      const lastSeenAt = variants
        .map((v) => v.lastSeenAt)
        .filter(Boolean)
        .sort()
        .reverse()[0] || null;

      result.push({
        ...primary,
        totalSeconds,
        sessionsCount,
        lastSeenAt
      });
    }

    return result.sort((a, b) => b.totalSeconds - a.totalSeconds);
  }
}
