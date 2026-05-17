import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration, ChartType } from 'chart.js';

@Component({
  selector: 'app-glueck-arena-chart',
  standalone: true,
  imports: [CommonModule, NgChartsModule],
  template: `
    <div class="gac" [style.height.px]="height">
      <canvas baseChart
        [type]="type"
        [data]="data"
        [options]="mergedOptions"
      ></canvas>
    </div>
  `,
  styles: [`.gac { position: relative; width: 100%; }`]
})
export class GlueckArenaChartComponent implements OnChanges {
  @Input() type: ChartType = 'bar';
  @Input() labels: string[] = [];
  @Input() datasets: { label: string; data: number[]; backgroundColor?: string | string[] }[] = [];
  @Input() height = 280;
  @Input() options: ChartConfiguration['options'] = {};

  data: ChartConfiguration['data'] = { labels: [], datasets: [] };
  mergedOptions: ChartConfiguration['options'] = {};

  ngOnChanges(): void {
    this.data = {
      labels: this.labels,
      datasets: this.datasets.map(d => ({
        label: d.label,
        data: d.data,
        backgroundColor: d.backgroundColor ?? 'rgba(64, 89, 128, 0.7)',
        borderRadius: 6,
      })),
    };
    this.mergedOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: this.datasets.length > 1 } },
      ...this.options,
    };
  }
}
