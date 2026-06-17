import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule, NavigationEnd } from '@angular/router';
import { MaterialModule } from '../../../../shared/material.module';
import { filter } from 'rxjs/operators';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-arena-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, MaterialModule],
  template: `
    <div class="arena-layout-wrap">
      <nav *ngIf="showTabs" mat-tab-nav-bar [tabPanel]="tabPanel" class="arena-tabs">
        <a mat-tab-link
           [routerLink]="['/glueck-arena']"
           routerLinkActive
           #gamesRla="routerLinkActive"
           [active]="gamesRla.isActive"
           [routerLinkActiveOptions]="{ exact: true }">
          <mat-icon>sports_esports</mat-icon>
          Games
        </a>
        <a mat-tab-link
           [routerLink]="['/glueck-arena/battlefield']"
           routerLinkActive
           #bfRla="routerLinkActive"
           [active]="bfRla.isActive">
          <mat-icon>sports_kabaddi</mat-icon>
          Battlefield
        </a>
      </nav>

      <mat-tab-nav-panel #tabPanel style="display:none"></mat-tab-nav-panel>

      <div class="arena-outlet">
        <router-outlet></router-outlet>
      </div>
    </div>
  `,
  styles: [`
    .arena-layout-wrap {
      max-width: 1500px;
      margin: 0 auto;
      padding: 20px 20px 48px;
      min-height: calc(100vh - 64px);
    }
    .arena-tabs {
      margin-bottom: 0;
      background: #fff;
      border-radius: 14px 14px 0 0;
      border: 1px solid #e2e8f0;
      border-bottom: none;
      padding: 0 8px;
    }
    .arena-outlet {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .arena-tabs.mat-tab-link {
      margin-right: 8px;
    }
    .arena-tabs a[mat-tab-link] {
      min-width: auto;
      gap: 4px;
      font-weight: 600;
      font-size: 14px;
      height: 48px;
      text-transform: none;
      letter-spacing: 0;
      opacity: 0.7;
    }
    .arena-tabs a[mat-tab-link][active] {
      opacity: 1;
    }
    .arena-tabs mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
      margin-right: 8px;
    }
  `]
})
export class ArenaLayoutComponent implements OnInit, OnDestroy {
  showTabs = true;
  private sub!: Subscription;

  constructor(private router: Router) {}

  ngOnInit() {
    this.updateShowTabs(this.router.url);
    this.sub = this.router.events.pipe(
      filter(e => e instanceof NavigationEnd)
    ).subscribe((e: NavigationEnd) => {
      this.updateShowTabs(e.urlAfterRedirects);
    });
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  private updateShowTabs(url: string) {
    const path = url.split('?')[0].split('#')[0];
    this.showTabs = path === '/glueck-arena' || path === '/glueck-arena/battlefield';
  }
}
