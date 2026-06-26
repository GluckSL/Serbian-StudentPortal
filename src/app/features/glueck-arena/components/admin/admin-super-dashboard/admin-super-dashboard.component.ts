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
      <!-- Header -->
      <div class="asc__header">
        <button class="asc__back-btn" mat-icon-button routerLink="/admin/glueck-arena">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <div class="asc__title-wrap">
          <div class="asc__title-icon"><mat-icon>dashboard</mat-icon></div>
          <div>
            <h1 class="asc__title">GlückArena Command Center</h1>
            <p class="asc__subtitle">Real-time arena monitoring &amp; analytics</p>
          </div>
        </div>
      </div>

      <!-- KPI Cards -->
      <div class="asc__kpis" *ngIf="metrics">
        <div class="asc__kpi-card asc__kpi-card--blue">
          <div class="asc__kpi-icon"><mat-icon>people</mat-icon></div>
          <div class="asc__kpi-body">
            <div class="asc__kpi-val">{{ metrics.multiplayer?.onlinePlayers || 0 }}</div>
            <div class="asc__kpi-label">Live players</div>
          </div>
        </div>
        <div class="asc__kpi-card asc__kpi-card--purple">
          <div class="asc__kpi-icon"><mat-icon>meeting_room</mat-icon></div>
          <div class="asc__kpi-body">
            <div class="asc__kpi-val">{{ metrics.multiplayer?.activeRooms || 0 }}</div>
            <div class="asc__kpi-label">Active rooms</div>
          </div>
        </div>
        <div class="asc__kpi-card asc__kpi-card--teal">
          <div class="asc__kpi-icon"><mat-icon>wifi</mat-icon></div>
          <div class="asc__kpi-body">
            <div class="asc__kpi-val">{{ metrics.sockets || 0 }}</div>
            <div class="asc__kpi-label">Socket connections</div>
          </div>
        </div>
        <div class="asc__kpi-card asc__kpi-card--orange">
          <div class="asc__kpi-icon"><mat-icon>trending_up</mat-icon></div>
          <div class="asc__kpi-body">
            <div class="asc__kpi-val">{{ enterprise?.dau || 0 }} / {{ enterprise?.wau || 0 }} / {{ enterprise?.mau || 0 }}</div>
            <div class="asc__kpi-label">DAU / WAU / MAU</div>
          </div>
        </div>
      </div>

      <!-- Tabs -->
      <div class="asc__tabs-wrap">
        <mat-tab-group class="asc__tabs" animationDuration="200ms">

          <mat-tab>
            <ng-template mat-tab-label>
              <mat-icon class="tab-icon">analytics</mat-icon> Enterprise Analytics
            </ng-template>
            <div class="asc__panel" *ngIf="enterprise">
              <div class="asc__info-row">
                <span class="asc__badge asc__badge--blue">Avg session: {{ enterprise.avgSessionSeconds }}s</span>
                <span class="asc__badge asc__badge--purple">
                  Completion funnel: {{ enterprise.funnel?.completed }}/{{ enterprise.funnel?.started }}
                </span>
              </div>
              <app-glueck-arena-chart *ngIf="sessionLabels.length"
                type="line"
                [labels]="sessionLabels"
                [datasets]="[{ label: 'Sessions', data: sessionData }]">
              </app-glueck-arena-chart>
            </div>
          </mat-tab>

          <mat-tab>
            <ng-template mat-tab-label>
              <mat-icon class="tab-icon">sports_esports</mat-icon> Live Multiplayer
            </ng-template>
            <div class="asc__panel" *ngIf="live">
              <div class="asc__row" *ngFor="let r of live.rooms">
                <span class="asc__room-code">{{ r.inviteCode }}</span>
                <span class="asc__status-chip" [class.active]="r.status === 'active'">{{ r.status }}</span>
                <span class="asc__player-count"><mat-icon>group</mat-icon>{{ r.players?.length || 0 }} players</span>
              </div>
              <p *ngIf="!live.rooms?.length" class="asc__empty">No active rooms right now.</p>
            </div>
          </mat-tab>

          <mat-tab>
            <ng-template mat-tab-label>
              <mat-icon class="tab-icon">security</mat-icon> Anti-cheat
            </ng-template>
            <div class="asc__panel">
              <div class="asc__row" *ngFor="let log of antiCheat">
                <strong class="asc__log-action">{{ log.action }}</strong>
                <span class="asc__log-date">{{ log.createdAt | date:'short' }}</span>
              </div>
              <p *ngIf="!antiCheat.length" class="asc__empty">No flagged events.</p>
            </div>
          </mat-tab>

          <mat-tab>
            <ng-template mat-tab-label>
              <mat-icon class="tab-icon">account_balance_wallet</mat-icon> Economy
            </ng-template>
            <div class="asc__panel" *ngIf="economy">
              <div class="asc__economy-grid">
                <div class="asc__eco-card">
                  <mat-icon>people</mat-icon>
                  <div class="asc__eco-val">{{ economy.economy?.users || 0 }}</div>
                  <div class="asc__eco-label">Users</div>
                </div>
                <div class="asc__eco-card">
                  <mat-icon>monetization_on</mat-icon>
                  <div class="asc__eco-val">{{ economy.economy?.totalCoins || 0 }}</div>
                  <div class="asc__eco-label">Total Coins</div>
                </div>
                <div class="asc__eco-card">
                  <mat-icon>diamond</mat-icon>
                  <div class="asc__eco-val">{{ economy.economy?.totalGems || 0 }}</div>
                  <div class="asc__eco-label">Total Gems</div>
                </div>
              </div>
            </div>
          </mat-tab>

          <mat-tab>
            <ng-template mat-tab-label>
              <mat-icon class="tab-icon">monitor_heart</mat-icon> Observability
            </ng-template>
            <div class="asc__panel" *ngIf="observability">
              <div class="asc__obs-grid">
                <div class="asc__obs-item">
                  <span class="asc__obs-label">Memory</span>
                  <span class="asc__obs-val">{{ observability.process?.memoryMb }} MB</span>
                </div>
                <div class="asc__obs-item">
                  <span class="asc__obs-label">Latency p95</span>
                  <span class="asc__obs-val">{{ observability.latency?.p95 }}ms</span>
                </div>
                <div class="asc__obs-item">
                  <span class="asc__obs-label">Redis</span>
                  <span class="asc__obs-val">{{ observability.sockets?.redisAdapter ? 'Online' : 'Offline' }}</span>
                </div>
                <div class="asc__obs-item">
                  <span class="asc__obs-label">Replays (24h)</span>
                  <span class="asc__obs-val">{{ observability.replays?.last24h }}</span>
                </div>
              </div>
              <a class="asc__action-btn" mat-stroked-button routerLink="/admin/glueck-arena/tournaments">
                <mat-icon>emoji_events</mat-icon> Tournaments
              </a>
            </div>
          </mat-tab>

          <mat-tab>
            <ng-template mat-tab-label>
              <mat-icon class="tab-icon">history</mat-icon> Audit Log
            </ng-template>
            <div class="asc__panel">
              <div class="asc__row" *ngFor="let log of auditLogs">
                <strong class="asc__log-action">{{ log.action }}</strong>
                <div class="asc__log-meta">
                  <span class="asc__severity-chip" [class.warn]="log.severity === 'warn'" [class.error]="log.severity === 'error'">
                    {{ log.severity }}
                  </span>
                  <span class="asc__log-date">{{ log.createdAt | date:'short' }}</span>
                </div>
              </div>
              <p *ngIf="!auditLogs.length" class="asc__empty">Audit log is clean.</p>
            </div>
          </mat-tab>

        </mat-tab-group>
      </div>
    </div>

    <div class="asc__loading" *ngIf="loading">
      <mat-spinner diameter="48"></mat-spinner>
      <p>Loading dashboard…</p>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .asc {
      padding: 28px 32px;
      max-width: 1100px;
      margin: 0 auto;
      font-family: 'Segoe UI', sans-serif;
    }

    /* ── Header ── */
    .asc__header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 28px;
    }
    .asc__back-btn {
      background: #f0f4ff;
      border-radius: 50%;
      color: #4f6ef7;
    }
    .asc__title-wrap {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .asc__title-icon {
      width: 48px; height: 48px;
      border-radius: 14px;
      background: linear-gradient(135deg, #4f6ef7, #7c3aed);
      display: flex; align-items: center; justify-content: center;
      color: #fff;
    }
    .asc__title-icon mat-icon { font-size: 26px; }
    .asc__title { margin: 0; font-size: 22px; font-weight: 700; color: #1e293b; }
    .asc__subtitle { margin: 2px 0 0; font-size: 13px; color: #64748b; }

    /* ── KPI Cards ── */
    .asc__kpis {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }
    .asc__kpi-card {
      border-radius: 18px;
      padding: 20px 22px;
      display: flex;
      align-items: center;
      gap: 16px;
      box-shadow: 0 2px 12px rgba(0,0,0,.07);
      background: #fff;
      border-left: 5px solid transparent;
    }
    .asc__kpi-card--blue   { border-left-color: #4f6ef7; }
    .asc__kpi-card--purple { border-left-color: #7c3aed; }
    .asc__kpi-card--teal   { border-left-color: #0d9488; }
    .asc__kpi-card--orange { border-left-color: #f59e0b; }
    .asc__kpi-icon {
      width: 44px; height: 44px;
      border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
    }
    .asc__kpi-card--blue   .asc__kpi-icon { background: #eef2ff; color: #4f6ef7; }
    .asc__kpi-card--purple .asc__kpi-icon { background: #f5f3ff; color: #7c3aed; }
    .asc__kpi-card--teal   .asc__kpi-icon { background: #f0fdfa; color: #0d9488; }
    .asc__kpi-card--orange .asc__kpi-icon { background: #fffbeb; color: #f59e0b; }
    .asc__kpi-val  { font-size: 26px; font-weight: 800; color: #1e293b; line-height: 1; }
    .asc__kpi-label { font-size: 12px; color: #64748b; margin-top: 4px; }

    /* ── Tabs ── */
    .asc__tabs-wrap {
      background: #fff;
      border-radius: 20px;
      box-shadow: 0 2px 16px rgba(0,0,0,.07);
      overflow: hidden;
      padding: 8px 0 20px;
    }
    .asc__tabs ::ng-deep .mat-mdc-tab-header { padding: 0 16px; }
    .tab-icon { font-size: 18px; margin-right: 6px; vertical-align: middle; }

    /* ── Panel ── */
    .asc__panel { padding: 24px 28px; }

    .asc__info-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 20px;
    }
    .asc__badge {
      border-radius: 999px;
      padding: 5px 14px;
      font-size: 13px;
      font-weight: 500;
    }
    .asc__badge--blue   { background: #eef2ff; color: #4f6ef7; }
    .asc__badge--purple { background: #f5f3ff; color: #7c3aed; }

    /* ── Rows ── */
    .asc__row {
      padding: 12px 0;
      border-bottom: 1px solid #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .asc__room-code { font-weight: 600; color: #1e293b; }
    .asc__status-chip {
      border-radius: 999px;
      padding: 3px 12px;
      font-size: 12px;
      background: #f1f5f9;
      color: #64748b;
    }
    .asc__status-chip.active { background: #dcfce7; color: #16a34a; }
    .asc__player-count { display: flex; align-items: center; gap: 4px; color: #64748b; font-size: 13px; }
    .asc__player-count mat-icon { font-size: 16px; }

    /* ── Log rows ── */
    .asc__log-action { color: #1e293b; font-size: 14px; }
    .asc__log-meta { display: flex; align-items: center; gap: 10px; }
    .asc__log-date { font-size: 12px; color: #94a3b8; }
    .asc__severity-chip {
      border-radius: 999px;
      padding: 2px 10px;
      font-size: 11px;
      background: #f1f5f9;
      color: #64748b;
    }
    .asc__severity-chip.warn  { background: #fffbeb; color: #d97706; }
    .asc__severity-chip.error { background: #fef2f2; color: #dc2626; }

    /* ── Economy ── */
    .asc__economy-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 16px;
    }
    .asc__eco-card {
      border-radius: 16px;
      background: #f8fafc;
      padding: 20px 18px;
      text-align: center;
      border: 1px solid #e2e8f0;
    }
    .asc__eco-card mat-icon { font-size: 28px; color: #7c3aed; }
    .asc__eco-val   { font-size: 24px; font-weight: 800; color: #1e293b; margin: 8px 0 4px; }
    .asc__eco-label { font-size: 12px; color: #64748b; }

    /* ── Observability ── */
    .asc__obs-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 14px;
      margin-bottom: 20px;
    }
    .asc__obs-item {
      border-radius: 14px;
      background: #f8fafc;
      padding: 16px 18px;
      border: 1px solid #e2e8f0;
    }
    .asc__obs-label { display: block; font-size: 12px; color: #64748b; margin-bottom: 6px; }
    .asc__obs-val   { display: block; font-size: 20px; font-weight: 700; color: #1e293b; }
    .asc__action-btn {
      border-radius: 999px !important;
      padding: 0 22px !important;
    }

    /* ── Empty / Loading ── */
    .asc__empty {
      color: #94a3b8;
      text-align: center;
      padding: 32px 0;
      font-size: 14px;
    }
    .asc__loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 60px 0;
      gap: 16px;
      color: #64748b;
    }
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
        this.sessionData   = (r.sessionTrend || []).map((x: { count: number }) => x.count);
      }
    });
    this.svc.adminLiveMultiplayer().subscribe({ next: (r) => { this.live = r; } });
    this.svc.adminAntiCheat().subscribe({ next: (r) => { this.antiCheat = r.logs || []; } });
    this.svc.adminEconomyDashboard().subscribe({ next: (r) => { this.economy = r; this.loading = false; } });
    this.svc.adminObservability().subscribe({ next: (r) => { this.observability = r.dashboard; } });
    this.svc.adminAuditViewer().subscribe({ next: (r) => { this.auditLogs = r.logs || []; } });
  }
}
