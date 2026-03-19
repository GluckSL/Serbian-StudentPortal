//src/app/components/student-dashnoard/student-dashbaord.module.ts

import { NgModule, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StudentDashboardComponent } from './student-dashboard.component';
import { FormsModule } from '@angular/forms';
import { SafeUrlPipe } from '../../pipes/safe-url.pipe';
import { RouterModule, Routes } from '@angular/router';
import { MaterialModule } from '../../shared/material.module';
import { NgChartsModule } from 'ng2-charts';
import { StudentRoutingModule } from './student-routing.module';
import { MeetingNotificationsComponent } from './meeting-notifications.component';


const routes: Routes = [
  { path: '', component: StudentDashboardComponent}
];

@NgModule({
  declarations: [
    StudentDashboardComponent,
    SafeUrlPipe,
  ],
  imports: [CommonModule,
            RouterModule.forChild(routes),
            MaterialModule,
            NgChartsModule,
            MeetingNotificationsComponent,  // Import standalone component
            FormsModule,
            StudentRoutingModule,
        ],
  exports: [StudentDashboardComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class StudentDashboardModule {}


