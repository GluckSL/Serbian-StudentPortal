// src/app/components/student-dashboard/student-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { StudentDashboardComponent } from './student-dashboard.component';
import { StudentAiDashboardComponent } from '../student-ai-dashboard/student-ai-dashboard.component';
import { StudentAssignmentsComponent } from '../student-assignments/student-assignments.component';
import { StudentNotificationsComponent } from '../student-notifications/student-notifications.component';
import { AuthGuard } from '../../guards/auth.guard';
import { RoleGuard } from '../../guards/role.guard';

const routes: Routes = [
  {
    path: 'student-dashboard',
    redirectTo: '/student-progress',
    pathMatch: 'full'
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class StudentRoutingModule {}
