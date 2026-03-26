import { Component, OnInit, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { NavService, NavGroup } from '../services/nav.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss']
})
export class SidebarComponent implements OnInit {
  @Output() closeSidebar = new EventEmitter<void>();

  collapsed: Record<string, boolean> = {};
  navGroups: NavGroup[] = [];
  userRole: string = '';
  userName: string = '';
  userEmail: string = '';

  constructor(
    private authService: AuthService,
    private navService: NavService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.authService.currentUser$.subscribe(user => {
      if (user) {
        this.userRole = user.role || '';
        this.userName = user.name || '';
        this.userEmail = user.email || '';
        this.navGroups = this.navService.getNavForRole(this.userRole);
      }
    });
  }

  getRoute(item: any): string {
    if (item.route === '__dashboard__') {
      return this.navService.getDashboardRoute(this.userRole);
    }
    return item.route;
  }

  toggle(group: string): void {
    this.collapsed[group] = !this.collapsed[group];
  }

  navigateTo(route: string): void {
    this.router.navigate([route]);
    this.closeSidebar.emit();
  }

  logout(): void {
    this.authService.logout().subscribe(() => {
      this.router.navigate(['/home']);
    });
    this.closeSidebar.emit();
  }

  get initials(): string {
    return this.userName?.slice(0, 2).toUpperCase() || '??';
  }

  get roleColor(): string {
    const map: Record<string, string> = {
      ADMIN: 'linear-gradient(135deg,#1e3a8a,#1d4ed8)',
      TEACHER_ADMIN: 'linear-gradient(135deg,#1e3a8a,#1d4ed8)',
      TEACHER: 'linear-gradient(135deg,#065f46,#059669)',
      STUDENT: 'linear-gradient(135deg,#7c2d12,#b45309)'
    };
    return map[this.userRole] || 'linear-gradient(135deg,#1e3a8a,#1d4ed8)';
  }

  get badgeColor(): string {
    const map: Record<string, string> = {
      ADMIN: '#7c3aed', TEACHER_ADMIN: '#7c3aed',
      TEACHER: '#0891b2', STUDENT: '#d97706'
    };
    return map[this.userRole] || '#7c3aed';
  }
}
