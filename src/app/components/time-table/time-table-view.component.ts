import { Component, OnInit, OnDestroy } from '@angular/core';
import { TimeTableService } from '../../services/timeTable.service';
import { AuthService } from '../../services/auth.service';
import { StudentService } from '../../services/student.service';
import { TeacherService } from '../../services/teacher.service';
import { ZoomService } from '../../services/zoom.service';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';
import { NotificationService } from '../../services/notification.service';
import { JoinClassFlowService } from '../../services/join-class-flow.service';

interface TimeSlot {
  start: string;
  end: string;
  classStatus?: string;
  meetingLinked?: boolean;
  zoomJoinUrl?: string;
  zoomPassword?: string;
  [key: string]: any;
}

interface TimeTable {
  _id?: string;
  batch: string;
  medium: string;
  plan: string;   
  weekStartDate: Date;
  weekEndDate: Date;
  assignedTeacher: string;
  monday?: TimeSlot[];
  tuesday?: TimeSlot[];
  wednesday?: TimeSlot[];
  thursday?: TimeSlot[];
  friday?: TimeSlot[];
  saturday?: TimeSlot[];
  sunday?: TimeSlot[];
  classStatus?: 'Scheduled' | 'Cancelled';
  [key: string]: any;
}

interface UserProfile {
  role: string;
  batch?: string;
  medium?: string;
  subscription?: string;
  studentStatus?: string;
  _id?: string;
  [key: string]: any;
}

interface ZoomMeeting {
  _id: string;
  batch: string;
  plan: 'SILVER' | 'PLATINUM';
  topic: string;
  startTime: Date;
  duration: number;
  joinUrl: string;
  status: string;
  attendees: any[];
  [key: string]: any;
}

@Component({
  selector: 'app-time-table-view',
  imports: [FormsModule, CommonModule, HttpClientModule, RouterModule],
  standalone: true,
  templateUrl: './time-table-view.component.html',
  styleUrls: ['./time-table-view.component.css']
})
export class TimeTableViewComponent implements OnInit, OnDestroy {
  timeTables: TimeTable[] = [];
  hiddenTimeTableIds = new Set<string>();
  showPreviousWeeksModal = false;
  teachersCache: { [key: string]: string } = {}; // cache id => name
  userRole: string = '';
  userProfile?: UserProfile;
  viewMode: 'table' | 'calendar' = 'table';
  adminBatchOptions: string[] = [];
  selectedAdminBatch: string = 'ALL';
  
  // Zoom meetings
  zoomMeetings: ZoomMeeting[] = [];
  meetingsLoaded: boolean = false;
  
  // Auto-refresh timer
  private refreshInterval: any;

  constructor(
    private timeTableService: TimeTableService,
    private authService: AuthService,
    private studentService: StudentService,
    private teacherService: TeacherService,
    private zoomService: ZoomService,
    private notify: NotificationService,
    private joinClassFlow: JoinClassFlowService,
  ) {}

  ngOnInit(): void {
    this.loadUserProfile();
    
    // Auto-refresh every 30 seconds
    this.refreshInterval = setInterval(() => {
      this.loadZoomMeetings();
    }, 30000);
  }
  
  ngOnDestroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  // Load user profile and then timetables based on role
  private loadUserProfile(): void {
    this.authService.getUserProfile().subscribe({
      next: (profile: UserProfile) => {
        this.userProfile = profile;
        this.userRole = profile.role;

        if (this.userRole === 'STUDENT' && profile.studentStatus === 'ONGOING') {
          this.loadTimeTablesforStudent(profile.batch!, profile.subscription!);
        } else if (this.userRole === 'ADMIN' || this.userRole === 'SUB_ADMIN') {
          this.loadTimeTables();
        } else if (this.userRole === 'TEACHER') {
          if (profile._id) {
            this.loadTimeTablesforTeacher(profile._id!);
          } else {
            console.error('Teacher profile _id is undefined');
          }
        }
        
        // Load Zoom meetings after profile is loaded
        this.loadZoomMeetings();
      },
      error: (error) => {
        console.error('Error fetching profile:', error);
      }
    });
  }
  
  // Load Zoom meetings
  private loadZoomMeetings(): void {
    if (this.userRole === 'STUDENT') {
      this.zoomService.getStudentMeetings().subscribe({
        next: (response) => {
          this.zoomMeetings = response.data || [];
          this.meetingsLoaded = true;
        },
        error: (error) => {
          console.error('Error loading student meetings:', error);
          this.meetingsLoaded = true;
        }
      });
    } else if (this.userRole === 'TEACHER' || this.userRole === 'ADMIN' || this.userRole === 'SUB_ADMIN') {
      this.zoomService.getAllMeetings().subscribe({
        next: (response) => {
          this.zoomMeetings = response.data || response.meetings || [];
          this.meetingsLoaded = true;
        },
        error: (error) => {
          console.error('Error loading meetings:', error);
          this.meetingsLoaded = true;
        }
      });
    }
  }

  // Admin - all timetables (✅ filtered by current month)
  private loadTimeTables(): void {
    this.timeTableService.getTimeTables().subscribe(
      (data: TimeTable[]) => {
        // For admin view, show full history so current/upcoming and past can be separated in UI.
        this.timeTables = data || [];
        this.adminBatchOptions = [...new Set(this.timeTables.map((tt) => String(tt.batch || '').trim()).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
        if (this.selectedAdminBatch !== 'ALL' && !this.adminBatchOptions.includes(this.selectedAdminBatch)) {
          this.selectedAdminBatch = 'ALL';
        }
        this.preloadTeacherNames(this.timeTables); // ✅ preload teacher names
      },
      (error) => console.error('Error fetching timetables', error)
    );
  }

  // Student - only their timetable (✅ filtered by current month)
  private loadTimeTablesforStudent(batch: string, subscription: string): void {
    this.timeTableService.getTimeTablesbyBatchAndPlan(batch, subscription).subscribe(
      (data: TimeTable[]) => {
        
        const currentDate = new Date();
        const currentMonth = currentDate.getMonth();
        const currentYear = currentDate.getFullYear();

        // ✅ Filter timetables for current month only
        this.timeTables = data.filter((tt: any) => {
          const startDate = new Date(tt.weekStartDate);
          const endDate = new Date(tt.weekEndDate);
          return (
            (startDate.getMonth() === currentMonth && startDate.getFullYear() === currentYear) ||
            (endDate.getMonth() === currentMonth && endDate.getFullYear() === currentYear)
          );
        });

        this.preloadTeacherNames(this.timeTables); // ✅ also preload for student timetables
      },
      (error) => console.error('Error fetching student timetable', error)
    );
  }
  private loadTimeTablesforTeacher(teacherId: string): void {
    this.timeTableService.getTimeTablesByTeacher(teacherId).subscribe({
      next: (data: TimeTable[]) => {
        //console.log('Teacher timetable fetched:', data);

        const currentDate = new Date();
        const currentMonth = currentDate.getMonth();
        const currentYear = currentDate.getFullYear();

        // ✅ Filter timetables for current month only
        this.timeTables = data.filter((tt: any) => {
          const startDate = new Date(tt.weekStartDate);
          const endDate = new Date(tt.weekEndDate);
          return (
            (startDate.getMonth() === currentMonth && startDate.getFullYear() === currentYear) ||
            (endDate.getMonth() === currentMonth && endDate.getFullYear() === currentYear)
          );
        });

        this.preloadTeacherNames(this.timeTables); // ✅ also preload teacher names
      },
      error: (error) => console.error('Error fetching teacher timetable', error)
    });
  }


  // ✅ Preload teacher names (Option 2)
  private preloadTeacherNames(timeTables: TimeTable[]): void {
    const teacherIds = [...new Set(timeTables.map(tt => tt.assignedTeacher))];

    teacherIds.forEach(id => {
      if (!this.teachersCache[id]) {
        this.teacherService.getTeacherById(id).subscribe({
          next: (teacher) => {
            // based on backend structure { success, data: { name } }
            this.teachersCache[id] = teacher.data.name;
          },
          error: (err) => console.error('Error fetching teacher', err)
        });
      }
    });
  }

  findTeacherByID(assignedTeacher: string): string {
    return this.teachersCache[assignedTeacher] || 'Loading...';
  }

  private startOfToday(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  private toDate(value: Date | string): Date {
    return new Date(value);
  }

  private normalizeBatchLabel(value: string): string {
    return String(value || '').trim().toLowerCase();
  }

  onAdminBatchChange(): void {
    this.showPreviousWeeksModal = false;
  }

  get visibleTimeTables(): TimeTable[] {
    return this.timeTables.filter((tt) => {
      const notHidden = !tt._id || !this.hiddenTimeTableIds.has(tt._id);
      if (!notHidden) return false;

      const isAdminView = this.userRole === 'ADMIN' || this.userRole === 'SUB_ADMIN';
      if (!isAdminView || this.selectedAdminBatch === 'ALL') return true;

      return this.normalizeBatchLabel(tt.batch) === this.normalizeBatchLabel(this.selectedAdminBatch);
    });
  }

  get currentWeekTimeTable(): TimeTable | null {
    const today = this.startOfToday();
    const current = this.visibleTimeTables
      .filter((tt) =>
        this.toDate(tt.weekStartDate).getTime() <= today.getTime() &&
        this.toDate(tt.weekEndDate).getTime() >= today.getTime()
      )
      .sort((a, b) => this.toDate(a.weekStartDate).getTime() - this.toDate(b.weekStartDate).getTime());

    if (current.length) return current[0];

    // Fallback: nearest upcoming week if current week is missing.
    const upcoming = this.visibleTimeTables
      .filter((tt) => this.toDate(tt.weekStartDate).getTime() > today.getTime())
      .sort((a, b) => this.toDate(a.weekStartDate).getTime() - this.toDate(b.weekStartDate).getTime());
    return upcoming[0] || null;
  }

  get pastTimeTables(): TimeTable[] {
    const today = this.startOfToday();
    return this.visibleTimeTables
      .filter((tt) => this.toDate(tt.weekEndDate).getTime() < today.getTime())
      .sort((a, b) => this.toDate(b.weekStartDate).getTime() - this.toDate(a.weekStartDate).getTime());
  }

  openPreviousWeeksModal(): void {
    this.showPreviousWeeksModal = true;
  }

  closePreviousWeeksModal(): void {
    this.showPreviousWeeksModal = false;
  }

  hideTimeTable(tt: TimeTable, event: Event): void {
    event.stopPropagation();
    if (!tt._id) return;
    this.hiddenTimeTableIds.add(tt._id);
  }

  clearHiddenWeeks(): void {
    this.hiddenTimeTableIds.clear();
  }

  deleteTimeTable(tt: TimeTable, event: Event): void {
    event.stopPropagation();
    if (!tt._id) return;
    this.notify.confirm('Delete Timetable', 'Delete this timetable week permanently?', 'Yes, Delete', 'Cancel').subscribe(ok => {
      if (!ok) return;
      this.timeTableService.deleteTimeTable(tt._id!).subscribe({
        next: () => {
          this.hiddenTimeTableIds.delete(tt._id!);
          this.timeTables = this.timeTables.filter((item) => item._id !== tt._id);
        },
        error: (error) => {
          console.error('Error deleting timetable:', error);
          this.notify.error('Failed to delete timetable. Please try again.');
        }
      });
    });
  }

  groupByWeek(timeTables: TimeTable[], forStudent: boolean = false): { week: string; items: TimeTable[] }[] {
    const groups: { [key: string]: TimeTable[] } = {};

    for (const tt of timeTables) {
        let key = new Date(tt.weekStartDate).toDateString() + '_' + new Date(tt.weekEndDate).toDateString();

        // For STUDENT, include batch/medium/plan in key so only their timetable is counted
        if (forStudent) {
        key += `_${tt.batch}_${tt.medium}_${tt.plan}`;
        }

        if (!groups[key]) groups[key] = [];
        groups[key].push(tt);
    }

    return Object.keys(groups).map(k => ({ week: k, items: groups[k] }));
  }

  // Get date for specific day of the week
  getDateForDay(weekStartDate: Date, dayIndex: number): Date {
    const date = new Date(weekStartDate);
    date.setDate(date.getDate() + dayIndex);
    return date;
  }

  // Get current month and year
  getCurrentMonthYear(): string {
    const now = new Date();
    return now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  
  // Format a meeting's start/end time in IST (India Standard Time)
  formatMeetingTimeIST(meeting: ZoomMeeting): string {
    const tz = 'Asia/Kolkata';
    const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz };
    const start = new Date(meeting.startTime);
    const end = new Date(start.getTime() + (meeting.duration || 0) * 60000);
    const s = start.toLocaleTimeString('en-GB', opts);
    const e = end.toLocaleTimeString('en-GB', opts);
    return `${s} - ${e}`;
  }

  // Return IST date parts (year/month/day) for comparison
  private datePartsIST(d: Date): { y: number; m: number; day: number } {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
    const parts = fmt.formatToParts(d);
    return {
      y: Number(parts.find(p => p.type === 'year')?.value || 0),
      m: Number(parts.find(p => p.type === 'month')?.value || 0),
      day: Number(parts.find(p => p.type === 'day')?.value || 0),
    };
  }

  // Extract batch number string from a meeting (handles string and object batch fields)
  private extractBatchId(m: any): string {
    const rawBatch = m.batch;
    const batchStr = rawBatch && typeof rawBatch === 'object'
      ? String(rawBatch.name || rawBatch.title || rawBatch._id || rawBatch.value || '')
      : String(rawBatch || '');
    // Also check topic: "Batch 35 - ..." → "35"
    const topic = String(m.topic || '');
    const topicMatch = topic.match(/batch\s*[-:]?\s*(\d{1,4})/i);
    const topicBatch = topicMatch ? topicMatch[1] : '';
    return (batchStr + ' ' + topicBatch).trim();
  }

  // Find all Zoom meetings for a given calendar day (IST) and batch
  getMeetingsForDayBatch(date: Date, batch: string): ZoomMeeting[] {
    if (!this.meetingsLoaded || !this.zoomMeetings.length) return [];
    const target = this.datePartsIST(date);
    const batchNum = String(batch || '').match(/\d+/)?.[0] || String(batch || '').trim();
    return this.zoomMeetings.filter(m => {
      const md = this.datePartsIST(new Date(m.startTime));
      const mBatch = this.extractBatchId(m);
      const mNum = mBatch.match(/\d+/)?.[0] || mBatch;
      const batchOk = mNum === batchNum || mBatch.includes(String(batch).trim()) || String(batch).includes(mNum);
      return batchOk && md.y === target.y && md.m === target.m && md.day === target.day;
    }).sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }

  // Returns the display time label for a directly-linked slot (uses actual meeting IST time)
  getLinkedSlotTimeLabel(slot: any, date: Date, batch: string): string {
    const meeting = this.findMeetingForLinkedSlot(slot, date, batch);
    return meeting ? this.formatMeetingTimeIST(meeting) : `${slot.start} - ${slot.end}`;
  }

  // Find a meeting linked to a slot: first by URL, then by date+batch (IST)
  findMeetingForLinkedSlot(slot: any, date: Date, batch: string): ZoomMeeting | null {
    if (!this.meetingsLoaded || !this.zoomMeetings.length) return null;
    const slotUrl: string = slot.zoomJoinUrl || '';
    if (slotUrl) {
      const slotBase = slotUrl.split('?')[0];
      const byUrl = this.zoomMeetings.find(m =>
        m.joinUrl && (m.joinUrl === slotUrl || m.joinUrl.split('?')[0] === slotBase)
      );
      if (byUrl) return byUrl;
    }
    const dayMatches = this.getMeetingsForDayBatch(date, batch);
    return dayMatches[0] || null;
  }

  // Get Zoom meeting for a specific time slot (date+batch match, time-tolerant)
  getMeetingForSlot(date: Date, startTime: string, batch: string): ZoomMeeting | null {
    if (!this.meetingsLoaded || !this.zoomMeetings.length) return null;
    const dayMatches = this.getMeetingsForDayBatch(date, batch);
    if (!dayMatches.length) return null;
    // Try to pick the one closest in time to slot.start
    const parts = String(startTime || '').split(':').map(Number);
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      const slotMins = parts[0] * 60 + parts[1];
      const tz = 'Asia/Kolkata';
      const withDiff = dayMatches.map(m => {
        const mStart = new Date(m.startTime);
        const mParts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(mStart);
        const mH = Number(mParts.find(p => p.type === 'hour')?.value || 0);
        const mMin = Number(mParts.find(p => p.type === 'minute')?.value || 0);
        return { m, diff: Math.abs(mH * 60 + mMin - slotMins) };
      });
      return withDiff.sort((a, b) => a.diff - b.diff)[0].m;
    }
    return dayMatches[0];
  }
  
  // Get meeting status
  getMeetingStatus(meeting: ZoomMeeting): string {
    const now = new Date();
    const startTime = new Date(meeting.startTime);
    const endTime = new Date(startTime.getTime() + meeting.duration * 60000);
    
    if (now < startTime) {
      return 'upcoming';
    } else if (now >= startTime && now <= endTime) {
      return 'live';
    } else {
      return 'ended';
    }
  }
  
  // Get countdown for upcoming meeting
  getCountdown(meeting: ZoomMeeting): string {
    const now = new Date();
    const startTime = new Date(meeting.startTime);
    const diff = startTime.getTime() - now.getTime();
    
    if (diff <= 0) return '';
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `in ${days}d ${hours % 24}h`;
    } else if (hours > 0) {
      return `in ${hours}h ${minutes}m`;
    } else {
      return `in ${minutes}m`;
    }
  }
  
  // Check if meeting can be joined (15 minutes before start)
  canJoinMeeting(meeting: ZoomMeeting): boolean {
    const now = new Date();
    const startTime = new Date(meeting.startTime);
    const endTime = new Date(startTime.getTime() + meeting.duration * 60000);
    const fifteenMinsBefore = new Date(startTime.getTime() - 15 * 60000);
    
    return now >= fifteenMinsBefore && now <= endTime;
  }
  
  // Join meeting
  joinMeeting(meeting: ZoomMeeting): void {
    if (meeting.joinUrl) {
      this.joinClassFlow.openJoin(meeting, (msg) => this.notify.error(msg));
    }
  }
  
  // Join Zoom meeting from timetable slot
  joinZoomMeeting(joinUrl: string): void {
    if (joinUrl) {
      this.joinClassFlow.openJoin({ joinUrl }, (msg) => this.notify.error(msg));
    }
  }

}
