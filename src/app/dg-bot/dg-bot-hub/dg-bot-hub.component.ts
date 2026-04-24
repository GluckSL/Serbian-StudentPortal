import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { DgApiService } from '../dg-api.service';
import type { DgModuleSummary } from '../dg-bot.types';

@Component({
  selector: 'app-dg-bot-hub',
  standalone: true,
  imports: [CommonModule, RouterLink, MatButtonModule, MatCardModule, MatIconModule],
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
}
