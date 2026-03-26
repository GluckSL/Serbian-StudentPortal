//src/app/components/teacher-dashboard/teacher-dashboard.module.ts

import { NgModule, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TeacherDashboardComponent } from './teacher-dashboard.component';
import { TeacherRoutingModule } from './teacher-routing.module';
import { RouterModule, Routes } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MaterialModule } from '../../shared/material.module';
import { NgChartsModule } from 'ng2-charts';
import { TeacherAssignmentsComponent } from '../teacher-assignments/teacher-assignments.component';
import { HttpClientModule } from '@angular/common/http';  
import { TeacherNotificationsComponent } from '../teacher-notifications/teacher-notifications.component';
import { TeacherAssignmentTemplatesComponent } from '../teacher-assignment-templates/teacher-assignment-templates.component';

const routes: Routes = [
  { path: '', component: TeacherDashboardComponent }
];

@NgModule({
  declarations: [
    
  ],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild(routes),
    MaterialModule,
    NgChartsModule,
    TeacherRoutingModule,
    HttpClientModule,
    TeacherAssignmentsComponent,
    TeacherDashboardComponent,
    TeacherAssignmentTemplatesComponent,
    TeacherNotificationsComponent
    ],
  exports: [],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})

export class TeacherDashboardModule {}



