// src/app/components/teacher-dashboard/teacher-routing.module.ts
//import { RoleGuard } from '../../guards/role.guard';

import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TeacherDashboardComponent } from './teacher-dashboard.component';
import { TeacherMyClassesComponent } from './teacher-my-classes.component';
import { AuthGuard } from '../../guards/auth.guard'; // Ensure this path is correct


const routes: Routes = [
  { path: '', component: TeacherDashboardComponent, canActivate: [AuthGuard] },
  { path: 'my-classes', component: TeacherMyClassesComponent, canActivate: [AuthGuard] },
  {
    path: 'monthly-hours',
    loadComponent: () => import('../teachers/teacher-monthly-hours.component').then(m => m.TeacherMonthlyHoursComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'live-participation/:meetingId',
    loadComponent: () => import('./teacher-live-participation.component').then(m => m.TeacherLiveParticipationComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'class-analytics',
    loadComponent: () => import('./teacher-class-analytics.component').then(m => m.TeacherClassAnalyticsComponent),
    canActivate: [AuthGuard]
  }
];

@NgModule({
  imports: [
    RouterModule.forChild(routes),
    
  ],
  exports: [RouterModule]
})
export class TeacherRoutingModule {}
