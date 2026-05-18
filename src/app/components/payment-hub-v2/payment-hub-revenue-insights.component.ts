import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';
import { PaymentHubApiService, DashboardStats } from './payment-hub-api.service';

@Component({
  selector: 'app-payment-hub-revenue-insights',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule, MatProgressSpinnerModule, NgChartsModule],
  templateUrl: './payment-hub-revenue-insights.component.html',
  styleUrls: ['./payment-hub-insights-page.scss', './payment-hub-revenue-insights.component.scss'],
})
export class PaymentHubRevenueInsightsComponent implements OnInit {
  loading = true;
  stats: DashboardStats | null = null;

  doughnutData: ChartConfiguration<'doughnut'>['data'] = { labels: [], datasets: [] };
  doughnutOptions: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { usePointStyle: true, padding: 16 } },
    },
    cutout: '62%',
  };

  currencyBarData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  currencyBarOptions: ChartConfiguration<'bar'>['options'] = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: {
        grid: { color: 'rgba(148,163,184,0.2)' },
        ticks: { callback: (v) => Number(v).toLocaleString('en-IN') },
      },
      y: { grid: { display: false } },
    },
  };

  constructor(private readonly api: PaymentHubApiService) {}

  ngOnInit(): void {
    this.api.getDashboardStats().subscribe({
      next: (r) => {
        this.stats = r.data;
        this.buildCharts();
        this.loading = false;
      },
      error: () => {
        this.stats = null;
        this.loading = false;
      },
    });
  }

  private buildCharts(): void {
    if (!this.stats) return;
    const s = this.stats;
    this.doughnutData = {
      labels: ['Received (LKR)', 'Pending approval (LKR)', 'Overdue (LKR)'],
      datasets: [
        {
          data: [s.totalReceivedLKR, s.pendingApprovalAmountLKR, s.totalOverdueLKR],
          backgroundColor: ['#34d399', '#fbbf24', '#fb7185'],
          borderWidth: 0,
          hoverOffset: 8,
        },
      ],
    };

    this.currencyBarData = {
      labels: ['LKR', 'INR', 'USD'],
      datasets: [
        {
          label: 'Total received',
          data: [s.totalReceivedLKR, s.totalReceivedINR, s.totalReceivedUSD],
          backgroundColor: ['#6366f1', '#8b5cf6', '#22d3ee'],
          borderRadius: 8,
          borderSkipped: false,
        },
      ],
    };
  }

  fmt(n: number | undefined | null): string {
    if (n === undefined || n === null) return '0';
    return n.toLocaleString('en-IN');
  }
}
