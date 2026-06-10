const express = require('express');
const router = express.Router();
const TimeTable = require('../models/TimeTable');
const { verifyToken, isAdmin } = require('../middleware/auth');
const cron = require("node-cron");
const User = require("../models/User");
const transporter = require("../config/emailConfig");
const MeetingLink = require('../models/MeetingLink');

// Legacy crons below scanned every STUDENT every minute (N+1 DB + email) and blocked the
// Node event loop. WhatsApp + Zoom reminder jobs in jobs/ are the supported path.
// Set ENABLE_LEGACY_TIMETABLE_MINUTE_CRONS=1 only if you still need these emails.
const ENABLE_LEGACY_TIMETABLE_MINUTE_CRONS =
  /^(1|true|yes)$/i.test(String(process.env.ENABLE_LEGACY_TIMETABLE_MINUTE_CRONS || '0'));

// ==========================
// ✅ CREATE TIMETABLE
// ==========================
router.post("/", async (req, res) => {
  try {
    const {
      batch,
      medium,
      plan,
      weekStartDate,
      weekEndDate,
      assignedTeacher,
      monday = [],
      tuesday = [],
      wednesday = [],
      thursday = [],
      friday = [],
      saturday = [],
      sunday = [],
    } = req.body;

    const newTimeTable = new TimeTable({
      batch,
      medium,
      plan,
      weekStartDate,
      weekEndDate,
      assignedTeacher,
      monday,
      tuesday,
      wednesday,
      thursday,
      friday,
      saturday,
      sunday,
    });

    await newTimeTable.save();

    res.status(201).json({ message: 'Time table created successfully.', data: newTimeTable });
  } 
  catch (error) {
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// ==========================
// ✅ GET ALL TIMETABLES
// ==========================
router.get("/", async (req, res) => {
  try {
    const timeTables = await TimeTable.find();
    res.status(200).json(timeTables);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==========================
// ✅ GET TIMETABLE BY STUDENT QUERY
// ==========================
const { batchesAlign } = require('../utils/effectiveStudentBatch');

router.get("/forStudent", async (req, res) => {
  try {
    const { batch, plan } = req.query;
    const query = {};
    if (plan) {
      query.plan = new RegExp(`^${String(plan).trim()}$`, 'i');
    }

    let timeTables = await TimeTable.find(query);
    if (batch) {
      timeTables = timeTables.filter((tt) => batchesAlign(batch, tt.batch));
    }

    res.status(200).json(timeTables);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==========================
// ✅ GET TIMETABLES BY TEACHER ID (placed BEFORE /:id)
// ==========================
router.get("/forTeacher", async (req, res) => {
  try {
    const { teacherId } = req.query;

    if (!teacherId) {
      return res.status(400).json({ message: "teacherId is required" });
    }

    const timeTables = await TimeTable.find({ assignedTeacher: teacherId });

    if (!timeTables || timeTables.length === 0) {
      return res.status(404).json({ message: "No timetables found for this teacher." });
    }

    res.status(200).json(timeTables);
  } catch (error) {
    console.error("❌ Error fetching timetable for teacher:", error);
    res.status(500).json({ message: error.message || "Internal server error." });
  }
});

// ==========================
// ✅ GET TIMETABLE BY ID (kept AFTER forTeacher)
// ==========================
router.get("/:id", async (req, res) => {
  try {
    const timeTable = await TimeTable.findById(req.params.id);
    if (!timeTable) {
      return res.status(404).json({ message: "Time table not found." });
    }
    res.status(200).json(timeTable);
  } catch (error) {
    console.error("❌ Error fetching timetable:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

// ==========================
// ✅ UPDATE TIMETABLE BY ID
// ==========================
router.put("/:id", async (req, res) => {
  try {
    const {
      batch,
      medium,
      plan,
      weekStartDate,
      weekEndDate,
      assignedTeacher,
      monday = [],
      tuesday = [],
      wednesday = [],
      thursday = [],
      friday = [],
      saturday = [],
      sunday = [],
      classStatus = "Scheduled"
    } = req.body;

    const updatedTimeTable = await TimeTable.findByIdAndUpdate(
      req.params.id,
      {
        batch,
        medium,
        plan,
        weekStartDate,
        weekEndDate,
        assignedTeacher,
        monday,
        tuesday,
        wednesday,
        thursday,
        friday,
        saturday,
        sunday,
        classStatus
      },
      { new: true }
    );

    if (!updatedTimeTable) {
      return res.status(404).json({ message: "Time table not found." });
    }
    res.status(200).json({ message: "Time table updated successfully.", data: updatedTimeTable });
  } 
  catch (error) {
    res.status(500).json({ message: "Internal server error." });
  }

});

// ==========================
// ✅ DELETE TIMETABLE BY ID
// ==========================
router.delete("/:id", verifyToken, isAdmin, async (req, res) => {
  try {
    const deleted = await TimeTable.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: "Time table not found." });
    }
    return res.status(200).json({ message: "Time table deleted successfully." });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error." });
  }
});

// ==========================
// ✅ WEEKLY EMAIL CRON (SUNDAY 5PM)
// ==========================
cron.schedule("0 17 * * 0", async () => {
  try {
    const students = await User.find({ role: "STUDENT" });

    // 🗓️ Determine upcoming week range (Monday → Sunday)
    const now = new Date();
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + ((1 + 7 - now.getDay()) % 7)); // Next Monday
    nextMonday.setHours(0, 0, 0, 0);

    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextMonday.getDate() + 6);
    nextSunday.setHours(23, 59, 59, 999);


    for (const student of students) {
      const latestTT = await TimeTable.findOne({
        batch: student.batch,
        medium: student.medium,
        plan: student.subscription,
        weekStartDate: { $gte: nextMonday },
        weekEndDate: { $lte: nextSunday },
      }).lean();

      if (!latestTT) {
        continue;
      }

      // ✅ Check if student has at least one class during that week
      const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
      const hasClasses = days.some(
        (day) => Array.isArray(latestTT[day]) && latestTT[day].length > 0
      );

      if (!hasClasses) {
        continue;
      }

      // ✅ Send timetable email to student
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: student.email,
        subject: "📅 Your Upcoming Timetable - Glück Global",
        html: `
              <div style="font-family: Arial, sans-serif; color: #333; text-align:center;">
                <h2>Glück Global Student Portal</h2>
                <p>Hello <strong>${student.name}</strong>, here is your timetable for the week:</p>
                <h3>${new Date(latestTT.weekStartDate).toDateString()} - ${new Date(latestTT.weekEndDate).toDateString()}</h3>

                <table style="width:80%; margin:20px auto; border-collapse:collapse; text-align:center;">
                  <thead>
                    <tr style="background-color:#000e89; color:white;">
                      <th style="border:1px solid #ddd; padding:8px;">Day</th>
                      <th style="border:1px solid #ddd; padding:8px;">Schedule</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(() => {
                      const days = [
                        "monday",
                        "tuesday",
                        "wednesday",
                        "thursday",
                        "friday",
                        "saturday",
                        "sunday",
                      ];
                      return days.map(day => {
                        const slots = latestTT[day];
                        let schedule =
                          Array.isArray(slots) && slots.length > 0
                            ? slots.map(s => `${s.start} - ${s.end}`).join("<br>")
                            : "-";
                        return `
                          <tr>
                            <td style="border:1px solid #ddd; padding:8px;">${day.charAt(0).toUpperCase() + day.slice(1)}</td>
                            <td style="border:1px solid #ddd; padding:8px;">${schedule}</td>
                          </tr>
                        `;
                      }).join("");
                    })()}
                  </tbody>
                </table>

                <p style="font-size:13px; color:#888; margin-top:20px;">
                  Best regards,<br>
                  <strong>Glück Global Pvt Ltd</strong>
                </p>
              </div>
            `,
      };

      await transporter.sendMail(mailOptions);
    }
  } catch (err) {
    console.error("❌ Error in timetable cron job:", err);
  }
}, { timezone: "Asia/Colombo" });



// ==========================
// ✅ CLASS REMINDER CRON (EVERY MINUTE) — legacy; disabled by default
// ==========================
if (ENABLE_LEGACY_TIMETABLE_MINUTE_CRONS) {
cron.schedule('*/1 * * * *', async () => {

  try {
    const students = await User.find({ role: 'STUDENT' });
    if (!students?.length) return;

    const now = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" })
    );

    const todayWeekday = now
    .toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: 'Asia/Colombo'
    })
    .toLowerCase();

    const todayDateOnly = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );


    for (const student of students) {
      // ✅ Find the most recent timetable for the student
      const latestTT = await TimeTable.findOne({
        batch: student.batch,
        medium: student.medium,
        plan: student.subscription,
        weekStartDate: { $lte: todayDateOnly },
        weekEndDate: { $gte: todayDateOnly },
      })
      .sort({ weekStartDate: -1 })
      .lean();

      if (!latestTT) continue;

      // Convert UTC to SL DATE ONLY
      const weekStartSL = new Date(
        latestTT.weekStartDate.toLocaleString("en-US", {
          timeZone: "Asia/Colombo",
        })
      );

      const weekEndSL = new Date(
        latestTT.weekEndDate.toLocaleString("en-US", {
          timeZone: "Asia/Colombo",
        })
      );

      const startOnly = new Date(
        weekStartSL.getFullYear(),
        weekStartSL.getMonth(),
        weekStartSL.getDate()
      );

      const endOnly = new Date(
        weekEndSL.getFullYear(),
        weekEndSL.getMonth(),
        weekEndSL.getDate()
      );

      // Check if today is within the timetable’s valid week range
      if (todayDateOnly < startOnly || todayDateOnly > endOnly) {
        continue;
      }

      const todaySlots = latestTT[todayWeekday];
      if (!todaySlots?.length) continue;

      for (const slot of todaySlots) {
        if (slot.classStatus === 'Cancelled') {
          continue; // Skip cancelled classes
        }

        // ✅ NEW: Check if student is invited to this meeting
        if (slot.meetingLinked && slot.zoomMeetingId) {
          const meeting = await MeetingLink.findOne({
            zoomMeetingId: slot.zoomMeetingId
          }).lean();

          if (meeting) {
            // Check if student is in attendees list
            const isInvited = meeting.attendees.some(
              attendee => attendee.studentId && attendee.studentId.toString() === student._id.toString()
            );

            if (!isInvited) {
              // Student not invited - skip reminder
              continue;
            }
          }
        }

        const [hour, minute] = slot.start.split(':').map(Number);

        const classDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          hour,
          minute,
          0
        );

        // Only trigger for TODAY'S slot
        if (
          classDate.toDateString() !== todayDateOnly.toDateString()
        ) {
          continue;
        }

        const reminderTime = new Date(classDate.getTime() - 60 * 60 * 1000); // 1 hour before

        const diffMinutes = (now.getTime() - reminderTime.getTime()) / (1000 * 60);
        if (diffMinutes >= 0 && diffMinutes < 1) {

          // ✅ Use linked Zoom meeting info from timetable slot if available
          let meetingLink = null;
          let zoomLinkHTML = '';
          
          if (slot.meetingLinked && slot.zoomJoinUrl) {
            // Use the linked Zoom meeting from timetable
            zoomLinkHTML = `
              <p style="margin-top: 20px; font-size:15px;">
                Please use the following link to join your upcoming class:
                <br />
                <a href="${slot.zoomJoinUrl}" target="_blank" 
                  style="display:inline-block; margin-top:10px; background-color:#000e89; color:#fff; 
                          text-decoration:none; padding:10px 20px; border-radius:6px;">
                  Join Class
                </a>
                ${slot.zoomPassword ? `<br /><small style="color:#666; margin-top:5px;">Password: ${slot.zoomPassword}</small>` : ''}
              </p>
            `;
          } else {
            // Fallback: Find meeting link based on student's details
            meetingLink = await findMeetingLink(
              student.batch,
              student.subscription
            );
            
            if (meetingLink) {
              zoomLinkHTML = `
                <p style="margin-top: 20px; font-size:15px;">
                  Please use the following link to join your upcoming class:
                  <br />
                  <a href="${meetingLink.link}" target="_blank" 
                    style="display:inline-block; margin-top:10px; background-color:#000e89; color:#fff; 
                            text-decoration:none; padding:10px 20px; border-radius:6px;">
                    Join Class
                  </a>
                </p>
              `;
            } else {
              zoomLinkHTML = `
                <p style="margin-top: 20px; color:#999; font-size:14px;">
                  No meeting link is currently available for this class.
                </p>
              `;
            }
          }

        const oneHourReminder = {
          from: process.env.EMAIL_USER,
          to: student.email,
          subject: '⏰ Class Reminder - Glück Global',
          html: `
                  <div style="font-family: Arial, sans-serif; text-align:center; background:#f9f9f9; padding:20px;">
                    <div style="max-width:600px; margin:auto; background:#fff; padding:20px; border-radius:8px; box-shadow:0 4px 10px rgba(0,0,0,0.1);">
                      
                      <div style="max-width:600px; margin:2px; background:#000e89; border-radius:8px;">
                        <h2 style="color:white; margin:0; padding:10px 10px;">Glück Global - Class Reminder</h2>
                      </div>

                      <p>Hello <strong>${student.name}</strong>,</p>
                      <p>This is a reminder for your upcoming class:</p>

                      <ul style="list-style:none; padding:0; font-size:15px; text-align:center;">
                        <li><strong>Day:</strong> ${todayWeekday}</li>
                        <li><strong>Time:</strong> ${slot.start} - ${slot.end}</li>
                      </ul>

                      ${zoomLinkHTML}

                      <p style="margin-top:20px;">Please be prepared and join on time.</p>

                      <p style="font-size:13px; color:#888;">
                        Best regards,<br>
                        <strong>Glück Global Pvt Ltd</strong>
                      </p>
                    </div>
                  </div>
                `,
        };

          await transporter.sendMail(oneHourReminder);
        }
      }
    }
  } catch (err) {
    console.error('❌ Error in reminder cron job:', err);
  }
});


// ==================================================
// ✅ CLASS CANCELLATION REMINDER (2 HOURS BEFORE)
// ==================================================
cron.schedule('*/1 * * * *', async () => {

  try {
    const students = await User.find({ role: 'STUDENT' });
    if (!students?.length) return;

    const now = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" })
    );

    const todayWeekday = now.toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: 'Asia/Colombo'
    })
    .toLowerCase();

    const todayDateOnly = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );

    for (const student of students) {
      // ✅ Find the most recent timetable for the student
      const latestTT = await TimeTable.findOne({
        batch: student.batch,
        medium: student.medium,
        plan: student.subscription,
        weekStartDate: { $lte: todayDateOnly },
        weekEndDate: { $gte: todayDateOnly },
      })
      .sort({ weekStartDate: -1 })
      .lean();

    
      if (!latestTT) continue;

      // Convert UTC to SL DATE ONLY
      const weekStartSL = new Date(
        latestTT.weekStartDate.toLocaleString("en-US", {
          timeZone: "Asia/Colombo",
        })
      );

      const weekEndSL = new Date(
        latestTT.weekEndDate.toLocaleString("en-US", {
          timeZone: "Asia/Colombo",
        })
      );

      const startOnly = new Date(
        weekStartSL.getFullYear(),
        weekStartSL.getMonth(),
        weekStartSL.getDate()
      );

      const endOnly = new Date(
        weekEndSL.getFullYear(),
        weekEndSL.getMonth(),
        weekEndSL.getDate()
      );


      // Check if today is within the timetable’s valid week range
      if (todayDateOnly < startOnly || todayDateOnly > endOnly) {
        continue;
      }

      const todaySlots = latestTT[todayWeekday];
      if (!todaySlots?.length) continue;

      for (const slot of todaySlots) {

        if (slot.classStatus === 'Scheduled') {
          continue; // Skip scheduled classes
        }

        // ✅ NEW: Check if student is invited to this meeting
        if (slot.meetingLinked && slot.zoomMeetingId) {
          const meeting = await MeetingLink.findOne({
            zoomMeetingId: slot.zoomMeetingId
          }).lean();

          if (meeting) {
            // Check if student is in attendees list
            const isInvited = meeting.attendees.some(
              attendee => attendee.studentId && attendee.studentId.toString() === student._id.toString()
            );

            if (!isInvited) {
              // Student not invited - skip cancellation notice
              continue;
            }
          }
        }

        const [hour, minute] = slot.start.split(':').map(Number);

        const classDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          hour,
          minute,
          0
        );

        // Only trigger for TODAY'S slot
        if (
          classDate.toDateString() !== todayDateOnly.toDateString()
        ) {
          continue;
        }

        // ⏰ 2 hours before class
        const reminderTime = new Date(classDate.getTime() - 2 * 60 * 60 * 1000);

        const diffMinutes = (now.getTime() - reminderTime.getTime()) / (1000 * 60);

        // Run exactly at the minute window
        if (diffMinutes >= 0 && diffMinutes < 1) {

          const teacher = await User.findById(latestTT.assignedTeacher).lean();
          const teacherName = teacher ? teacher.name : "Assigned Tutor";

          const cancellationMail = {
            from: process.env.EMAIL_USER,
            to: student.email,
            subject: '❗ Class Cancellation Notice - Glück Global',
            html: `
              <p>Dear ${student.name},</p>
              <p>Please note that the Batch <strong>${student.batch}</strong> class scheduled on <strong>${todayWeekday}</strong> at <strong>${slot.start}</strong> with Tutor <strong>${teacherName}</strong> has been cancelled due to unforeseen circumstances.</p>
              
              <p>We sincerely apologize for the inconvenience. Regular sessions will continue as per the normal schedule.</p>
              
              <p>Thank you for your patience and cooperation.</p>
              
              <p>Best regards,<br>
              Glück Global Pvt Ltd</p>
            `,
          };

          await transporter.sendMail(cancellationMail);
        }
      }
    }

  } catch (err) {
    console.error('❌ Error in cancellation reminder cron job:', err);
  }
});
} else {
  console.log(
    '[timeTable] Legacy every-minute email crons are OFF (event-loop safe). ' +
      'WhatsApp/zoom jobs handle class reminders. Set ENABLE_LEGACY_TIMETABLE_MINUTE_CRONS=1 to re-enable.'
  );
}

// ==========================
// 🌅 DAILY 6 AM MORNING REMINDER
// ==========================
cron.schedule("0 6 * * *", async () => {

  try {
    const students = await User.find({ role: "STUDENT" });
    if (!students?.length) return;

    const now = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" })
    );

    const todayWeekday = now
    .toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: "Asia/Colombo",
    })
    .toLowerCase();

    const todayDateOnly = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );

    for (const student of students) {
      // find today's valid timetable
      const latestTT = await TimeTable.findOne({
        batch: student.batch,
        medium: student.medium,
        plan: student.subscription,
        weekStartDate: { $lte: todayDateOnly },
        weekEndDate: { $gte: todayDateOnly },
      })
      .sort({ weekStartDate: -1 })
      .lean();

      if (!latestTT) continue;

      const todaySlots = latestTT[todayWeekday];
      if (!todaySlots?.length) {
        continue;
      }

      // ✅ NEW: Filter slots to only include those where student is invited
      const invitedSlots = [];
      for (const slot of todaySlots) {
        // If slot has a linked meeting, check if student is invited
        if (slot.meetingLinked && slot.zoomMeetingId) {
          const meeting = await MeetingLink.findOne({
            zoomMeetingId: slot.zoomMeetingId
          }).lean();

          if (meeting) {
            const isInvited = meeting.attendees.some(
              attendee => attendee.studentId && attendee.studentId.toString() === student._id.toString()
            );

            if (isInvited) {
              invitedSlots.push(slot);
            }
            // If not invited, skip this slot
          } else {
            // Meeting not found, include slot anyway
            invitedSlots.push(slot);
          }
        } else {
          // No linked meeting, include slot
          invitedSlots.push(slot);
        }
      }

      // If no slots student is invited to, skip email
      if (invitedSlots.length === 0) {
        continue;
      }

      // format class list for email (only invited slots)
      const classListHTML = invitedSlots
        .map(s => `<li>${s.start} - ${s.end}</li>`)
        .join("");

      // ✅ Use linked Zoom meeting info from first invited slot if available
      let zoomLinkHTML = '';
      const firstSlot = invitedSlots[0];
      
      if (firstSlot.meetingLinked && firstSlot.zoomJoinUrl) {
        // Use the linked Zoom meeting from timetable
        zoomLinkHTML = `
          <p style="margin-top:20px;">
            <a href="${firstSlot.zoomJoinUrl}" target="_blank"
              style="display:inline-block; background-color:#000e89; color:#fff;
                    text-decoration:none; padding:10px 20px; border-radius:6px;">
              Join Class
            </a>
            ${firstSlot.zoomPassword ? `<br /><small style="color:#666; margin-top:5px;">Password: ${firstSlot.zoomPassword}</small>` : ''}
          </p>
        `;
      } else {
        // Fallback: find meeting link
        const meetingLink = await findMeetingLink(
          student.batch,
          student.subscription
        );
        
        if (meetingLink) {
          zoomLinkHTML = `
            <p style="margin-top:20px;">
              <a href="${meetingLink.link}" target="_blank"
                style="display:inline-block; background-color:#000e89; color:#fff;
                      text-decoration:none; padding:10px 20px; border-radius:6px;">
                Join Class
              </a>
            </p>
          `;
        } else {
          zoomLinkHTML = `
            <p style="margin-top:20px; color:#999;">
              No meeting link is available for your batch.
            </p>
          `;
        }
      }

      // send morning reminder
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: student.email,
        subject: `🎓 Class Reminder - You have class today!`,
        html: `
          <div style="font-family: Arial, sans-serif; text-align:center; background:#f9f9f9; padding:20px;">
            <div style="max-width:600px; margin:auto; background:#fff; padding:20px; border-radius:8px; box-shadow:0 4px 10px rgba(0,0,0,0.1);">
              
              <div style="background:#000e89; border-radius:8px;">
                <h2 style="color:white; margin:0; padding:10px;">Glück Global - Today's Classes</h2>
              </div>

              <p>Hello <strong>${student.name}</strong>,</p>
              <p>Hope you're having a great day! This is a friendly reminder that you have class today:</p>

              <ul style="list-style:none; padding:0; font-size:15px;">
                ${classListHTML}  
              </ul>

              ${zoomLinkHTML}

              <p style="margin-top:20px;">Make sure to join your sessions on time.</p>

              <p style="font-size:13px; color:#888;">
                Best regards,<br>
                <strong>Glück Global Pvt Ltd</strong>
              </p>
            </div>
          </div>
        `,

      };

      await transporter.sendMail(mailOptions);
    
    }
  } catch (err) {
    console.error("❌ Error in 6 AM morning reminders:", err);
  }
}, { timezone: "Asia/Colombo" });



// ==========================
// ✅ FIND MEETING LINK BY BATCH & MEDIUM
// ==========================
async function findMeetingLink(batch, subscriptionPlan) {
  try {
    const link = await MeetingLink.findOne({ 
      batch, 
      subscriptionPlan: { $regex: new RegExp(`^${subscriptionPlan}$`, "i") }
    }).lean();
    
    return link;

  } catch (err) {
    console.error('Error finding meeting link:', err.message);
    throw err;
  }
}

module.exports = router;
