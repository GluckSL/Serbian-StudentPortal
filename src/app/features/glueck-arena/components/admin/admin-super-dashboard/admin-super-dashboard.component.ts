import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MaterialModule } from '../../../../../shared/material.module';
import { InteractiveGameService } from '../../../services/interactive-game.service';
import { GlueckArenaChartComponent } from '../../../shared/glueck-arena-chart/glueck-arena-chart.component';

@Component({
  selector: 'app-admin-super-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, MaterialModule, GlueckArenaChartComponent],
  template: `
    <div class="asc">
      <div class="asc__header">
        <button mat-icon-button routerLink="/admin/glueck-arena"><mat-icon>arrow_back</mat-icon></button>
        <h1><mat-icon>dashboard</mat-icon> GlückArena Command Center</h1>
      </div>

      <div class="asc__kpis" *ngIf="metrics">
        <mat-card><mat-card-title>Live players</mat-card-title>
          <mat-card-content class="asc__val">{{ metrics.multiplayer?.onlinePlayers || 0 }}</mat-card-content>
        </mat-card>
        <mat-card><mat-card-title>Active rooms</mat-card-title>
          <mat-card-content class="asc__val">{{ metrics.multiplayer?.activeRooms || 0 }}</mat-card-content>
        </mat-card>
        <mat-card><mat-card-title>Socket connections</mat-card-title>
          <mat-card-content class="asc__val">{{ metrics.sockets || 0 }}</mat-card-content>
        </mat-card>
        <mat-card><mat-card-title>DAU / WAU / MAU</mat-card-title>
          <mat-card-content>{{ enterprise?.dau }} / {{ enterprise?.wau }} / {{ enterprise?.mau }}</mat-card-content>
        </mat-card>
      </div>

      <mat-tab-group>
        <mat-tab label="Enterprise analytics">
          <div class="asc__panel" *ngIf="enterprise">
            <p>Avg session: {{ enterprise.avgSessionSeconds }}s · Completion funnel: {{ enterprise.funnel?.completed }}/{{ enterprise.funnel?.started }}</p>
            <app-glueck-arena-chart *ngIf="sessionLabels.length"
              type="line"
              [labels]="sessionLabels"
              [datasets]="[{ label: 'Sessions', data: sessionData }]">
            </app-glueck-arena-chart>
          </div>
        </mat-tab>
        <mat-tab label="Live multiplayer">
          <div class="asc__panel" *ngIf="live">
            <div class="asc__row" *ngFor="let r of live.rooms">
              {{ r.inviteCode }} · {{ r.status }} · {{ r.players?.length }} players
            </div>
          </div>
        </mat-tab>
        <mat-tab label="Anti-cheat">
          <div class="asc__panel">
            <div class="asc__row" *ngFor="let log of antiCheat">
              <strong>{{ log.action }}</strong>
              <span>{{ log.createdAt | date:'short' }}</span>
            </div>
          </div>
        </mat-tab>
        <mat-tab label="Economy">
          <div class="asc__panel" *ngIf="economy">
            <p>Users: {{ economy.economy?.users }} · Coins: {{ economy.economy?.totalCoins }} · Gems: {{ economy.economy?.totalGems }}</p>
          </div>
        </mat-tab>
        <mat-tab label="Observability">
          <div class="asc__panel" *ngIf="observability">
            <p>Memory: {{ observability.process?.memoryMb }} MB · p95: {{ observability.latency?.p95 }}ms</p>
            <p>Redis: {{ observability.sockets?.redisAdapter ? 'on' : 'off' }} · Replays 24h: {{ observability.replays?.last24h }}</p>
            <a mat-stroked-button routerLink="/admin/glueck-arena/tournaments">Tournaments</a>
          </div>
        </mat-tab>
        <mat-tab label="Audit log">
          <div class="asc__panel">
            <div class="asc__row" *ngFor="let log of auditLogs">
              <strong>{{ log.action }}</strong>
              <span>{{ log.severity }} · {{ log.createdAt | date:'short' }}</span>
            </div>
          </div>
        </mat-tab>
      </mat-tab-group>
    </div>
    <mat-spinner *ngIf="loading" class="asc__spin"></mat-spinner>
  `,
  styles: [`
    .asc { padding: 24px; max-width: 1100px; margin: 0 auto; }
    .asc__header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
    .asc__kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .asc__val { font-size: 32px; font-weight: 800; color: #405980; }
    .asc__panel { padding: 24px 0; }
    .asc__spin { margin: 48px auto; display: block; }
    .asc__row { padding: 8px 0; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; gap: 12px; }
  `]
})
export class AdminSuperDashboardComponent implements OnInit {
  loading = true;
  metrics: any = null;
  enterprise: any = null;
  live: any = null;
  antiCheat: any[] = [];
  economy: any = null;
  observability: any = null;
  auditLogs: any[] = [];
  sessionLabels: string[] = [];
  sessionData: number[] = [];

  constructor(private svc: InteractiveGameService) {}

  ngOnInit() {
    this.svc.adminMetrics().subscribe({ next: (r) => { this.metrics = r; } });
    this.svc.adminEnterpriseAnalytics().subscribe({
      next: (r) => {
        this.enterprise = r;
        this.sessionLabels = (r.sessionTrend || []).map((x: { _id: string }) => x._id);
        this.sessionData = (r.sessionTrend || []).map((x: { count: number }) => x.count);
      }
    });
    this.svc.adminLiveMultiplayer().subscribe({ next: (r) => { this.live = r; } });
    this.svc.adminAntiCheat().subscribe({ next: (r) => { this.antiCheat = r.logs || []; } });
    this.svc.adminEconomyDashboard().subscribe({ next: (r) => { this.economy = r; this.loading = false; } });
    this.svc.adminObservability().subscribe({ next: (r) => { this.observability = r.dashboard; } });
    this.svc.adminAuditViewer().subscribe({ next: (r) => { this.auditLogs = r.logs || []; } });
  }
}
