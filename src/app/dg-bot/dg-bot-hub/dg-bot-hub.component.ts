import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { DgApiService } from '../dg-api.service';
import type { DgModuleSummary } from '../dg-bot.types';

@Component({
  selector: 'app-dg-bot-hub',
  standalone: true,
  imports: [CommonModule, RouterLink, MatButtonModule, MatIconModule],
  templateUrl: './dg-bot-hub.component.html',
  styleUrl: './dg-bot-hub.component.scss',
})
export class DgBotHubComponent implements OnInit {
  modules: DgModuleSummary[] = [];
  loading = true;
  error: string | null = null;

  constructor(private dgApi: DgApiService) {}

  ngOnInit(): void {
    this.dgApi.listStudentModules().subscribe({
      next: (r) => {
        this.modules = r.modules || [];
        this.loading = false;
      },
      error: (e) => {
        this.error = e?.error?.message || 'Could not load modules';
        this.loading = false;
      },
    });
  }

  get totalModules(): number {
    return this.modules.length;
  }

  get a1Count(): number {
    return this.modules.filter((m) => (m.level || '').toUpperCase() === 'A1').length;
  }

  get a2Count(): number {
    return this.modules.filter((m) => (m.level || '').toUpperCase() === 'A2').length;
  }

  get b1PlusCount(): number {
    return this.modules.filter((m) => {
      const lvl = (m.level || '').toUpperCase();
      return lvl.startsWith('B') || lvl.startsWith('C');
    }).length;
  }

  get totalScenes(): number {
    return this.modules.reduce((sum, m) => sum + (m.scenes?.length || 0), 0);
  }

  trackModule = (_: number, m: DgModuleSummary): string => m._id;
}
