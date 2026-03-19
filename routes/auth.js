//routes/auth.js

require('dotenv').config();  // Load environment variables

const express = require("express");
const axios = require("axios");
const cron = require("node-cron");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Course = require("../models/Course");
const StudentLogs = require("../models/StudentLogs");
const router = express.Router();
const transporter = require("../config/emailConfig");

//const auth = require("../middleware/auth");
const { verifyToken, isAdmin } = require('../middleware/auth');
const checkRole = require("../middleware/checkRole");
const JWT_SECRET = process.env.JWT_SECRET;

// Read CRM data from Monday.com — Full sync: update existing + create new (PLATINUM + Ongoing only)
cron.schedule(
  "50 23 * * *", // ✅ Every day at 11:50 PM
  async () => {
    console.log("🔄 Starting Monday CRM full sync...");

    try {
      const BOARD_ID = process.env.MONDAY_BOARD_ID;

      // Fetch ALL items from the board (paginated)
      let allItems = [];
      let cursor = null;
      let hasMore = true;

      while (hasMore) {
        const query = cursor
          ? `query ($boardId: [ID!], $cursor: String!) {
              boards(ids: $boardId) {
                items_page(limit: 500, cursor: $cursor) {
                  cursor
                  items {
                    id
                    name
                    column_values {
                      id
                      text
                    }
                  }
                }
              }
            }`
          : `query ($boardId: [ID!]) {
              boards(ids: $boardId) {
                items_page(limit: 500) {
                  cursor
                  items {
                    id
                    name
                    column_values {
                      id
                      text
                    }
                  }
                }
              }
            }`;

        const variables = cursor ? { boardId: [BOARD_ID], cursor } : { boardId: [BOARD_ID] };

        const response = await axios.post(
          "https://api.monday.com/v2",
          { query, variables },
          {
            headers: {
              Authorization: process.env.MONDAY_API_TOKEN,
              "Content-Type": "application/json"
            }
          }
        );

        const page = response.data.data.boards[0].items_page;
        allItems = allItems.concat(page.items);
        cursor = page.cursor;
        hasMore = !!cursor;
      }

      console.log(`📋 Fetched ${allItems.length} total items from Monday board ${BOARD_ID}`);

      // Filter: Only PLATINUM subscription + Ongoing status
      const eligibleItems = allItems.filter(item => {
        const get = id => item.column_values.find(c => c.id === id)?.text || "";
        const packageOpted = get("color_mm02jfyb").toUpperCase().trim();
        const currentStatus = get("color_mm019dcv").toUpperCase().trim();
        return packageOpted === "PLATINUM" && currentStatus === "ONGOING";
      });

      console.log(`✅ ${eligibleItems.length} items match PLATINUM + Ongoing filter`);

      let created = 0;
      let updated = 0;
      let skipped = 0;
      let errors = 0;

      for (const item of eligibleItems) {
        try {
          const get = id => item.column_values.find(c => c.id === id)?.text || "";

          const name              = item.name;
          const email             = get("text_mkw3spks").trim().toLowerCase();
          const phoneNumber       = get("text_mkw2wpvr");
          const whatsappNumber    = get("phone_mkv0a5mm");
          const address           = get("text_mkv080k2");
          const ageStr            = get("text_mkw38wse");
          const qualifications    = get("text_mkw32n6r");
          const enrollmentDateStr = get("date_mkw7wejn");
          const servicesOpted     = get("dropdown_mkw0txee") || get("color_mm023vmt") || get("text_mkwz1j6q");
          const subscription      = get("color_mm02jfyb").toUpperCase().trim();
          const languageLevelOpted = get("color_mm02c95");
          const batch             = get("dropdown_mkxx6cfp");
          const studentStatus     = get("color_mm019dcv").toUpperCase().trim();
          const level             = get("dropdown_mkzshj5a").toUpperCase().trim();
          const otherLanguageKnown = get("dropdown_mkzsadkp");
          const medium            = get("dropdown_mkw09h9j");
          const leadSource        = get("dropdown_mm0d9jrv");
          const stream            = get("text_mkwtq4fq");
          const batchStartedOnStr = get("date_mkxkba8t");
          const teacherIncharge   = get("dropdown_mkw72gz4");

          // Withdrawal fields
          const dateWithdrewStr       = get("date_mkzzgvxv");
          const reasonForWithdrawing  = get("text_mkzz24qx");

          // Course dates
          const a1StartStr      = get("date_mm1dceqs");
          const a1CompletedStr  = get("date_mkzt1xj");
          const a2StartStr      = get("date_mm1dwzc8");
          const a2CompletedStr  = get("date_mkztk1pn");
          const b1StartStr      = get("date_mm1d7az3");
          const b1CompletedStr  = get("date_mkztxce7");
          const b2StartStr      = get("date_mm1dbv8e");
          const b2CompletedStr  = get("date_mkztwdfn");

          // Exam fields
          const examPassedDateStr   = get("date_mkw7zwjh");
          const languageExamStatus  = get("color_mkw7syb");
          const candidateStatus     = get("text_mkzzjdv1");
          const examRemark          = get("text_mkzzbgz1");
          const readingScore        = get("numeric_mkzz97be");
          const listeningScore      = get("numeric_mkzz8sr4");
          const writingScore        = get("numeric_mkzz2bzg");
          const speakingScore       = get("numeric_mkzz8q32");

          if (!email) {
            skipped++;
            continue;
          }

          // Helper to parse date strings safely
          const parseDate = (str) => str ? new Date(str) : null;

          // Build the update data object
          const updateData = {
            name,
            phoneNumber,
            whatsappNumber,
            address,
            age: ageStr ? parseInt(ageStr) : null,
            qualifications,
            servicesOpted,
            subscription,
            languageLevelOpted,
            batch,
            studentStatus,
            level,
            otherLanguageKnown,
            medium: medium ? [medium] : [],
            leadSource,
            servicesOpted,
            stream,
            teacherIncharge,
            reasonForWithdrawing,
            languageExamStatus,
            candidateStatus,
            examRemark,
            enrollmentDate: parseDate(enrollmentDateStr),
            batchStartedOn: parseDate(batchStartedOnStr),
            dateWithdrew: parseDate(dateWithdrewStr),
            examPassedDate: parseDate(examPassedDateStr),
            examScores: {
              reading: readingScore ? parseFloat(readingScore) : null,
              listening: listeningScore ? parseFloat(listeningScore) : null,
              writing: writingScore ? parseFloat(writingScore) : null,
              speaking: speakingScore ? parseFloat(speakingScore) : null
            },
            courseStartDates: {
              A1StartDate: parseDate(a1StartStr),
              A2StartDate: parseDate(a2StartStr),
              B1StartDate: parseDate(b1StartStr),
              B2StartDate: parseDate(b2StartStr)
            },
            courseCompletionDates: {
              A1CompletionDate: parseDate(a1CompletedStr),
              A2CompletionDate: parseDate(a2CompletedStr),
              B1CompletionDate: parseDate(b1CompletedStr),
              B2CompletionDate: parseDate(b2CompletedStr)
            },
            updatedAt: new Date()
          };

          // Check if user already exists
          const existingUser = await User.findOne({ email });

          if (existingUser) {
            // ✅ UPDATE existing user with latest CRM data
            await User.updateOne({ email }, { $set: updateData });
            updated++;
          } else {
            // ✅ CREATE new user
            const regNo = await generateRegNo("STUDENT");
            const passwordPlain = await generatePassword("STUDENT", regNo);
            const hashedPassword = await bcrypt.hash(passwordPlain, 10);

            const newUser = new User({
              ...updateData,
              email,
              regNo,
              password: hashedPassword,
              role: "STUDENT",
              registeredAt: parseDate(enrollmentDateStr) || new Date(),
              createdAt: new Date()
            });

            await newUser.save();

            // Send welcome email with credentials
            try {
              await transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: email,
                subject: "Welcome to Glück Global Student Portal 🎉",
                html: `
                  <div style="font-family: Arial, sans-serif; color: #000000; line-height: 1.6;">
                    <p>Hello ${name},</p>

                    <p>You have successfully registered to the <strong>Glück Global Student Portal</strong>. Here are your login credentials:</p>

                    <ul>
                      <li><strong>Web App ID:</strong> ${regNo}</li>
                      <li><strong>Password:</strong> ${passwordPlain}</li>
                    </ul>

                    <p>Please keep this information safe and do not share it with anyone.</p>

                    <p>You can access the Portal at: <a href="https://gluckstudentsportal.com" target="_blank">https://gluckstudentsportal.com</a></p>

                    <p>Best regards,<br>
                    <strong>Glück Global Pvt Ltd</strong></p>
                  </div>
                `
              });

              newUser.lastCredentialsEmailSent = new Date();
              await newUser.save();
              console.log(`  📧 Credentials email sent to ${email}`);
            } catch (emailErr) {
              console.error(`  ⚠️ Failed to send email to ${email}:`, emailErr.message);
            }

            created++;
          }
        } catch (itemErr) {
          console.error(`  ❌ Error processing item "${item.name}":`, itemErr.message);
          errors++;
        }
      }

      console.log(`\n✅ Monday CRM sync completed:`);
      console.log(`   Created: ${created} | Updated: ${updated} | Skipped: ${skipped} | Errors: ${errors}`);

    } catch (err) {
      console.error("❌ CRM sync error:", err.message);
    }
  },
  {
    timezone: "Asia/Colombo" // ✅ Set timezone to Sri Lanka
  }
);



// ✅ Reg No generation for different roles
async function generateRegNo(role) {
  // map roles to prefixes
  const prefixMap = {
    STUDENT: "STUD",
    TEACHER: "T",
    ADMIN: "AD"
  };

  const prefix = prefixMap[role] || role.substring(0, 2).toUpperCase(); // fallback

  const lastUser = await User.findOne({
    role: role,
    regNo: { $regex: `^${prefix}\\d+$` }
  })
    .sort({ createdAt: -1 })
    .exec();

  let nextNumber = 1;

  if (lastUser && lastUser.regNo) {
    const match = lastUser.regNo.match(new RegExp(`^${prefix}(\\d+)$`));
    if (match) {
      nextNumber = parseInt(match[1], 10) + 1;
    }
  }

  return prefix + String(nextNumber).padStart(3, "0");
}

//Password generation
async function generatePassword(role, regNo) {
  // map roles to prefixes
  const prefixMap = {
    STUDENT: "Student",
    TEACHER: "Teacher",
    ADMIN: "Admin"
  };

  const prefix = prefixMap[role.toUpperCase()] || role;

  // get last 3 characters of regNo
  const lastThreeDigits = regNo.slice(-3);

  // get current year
  const currentYear = new Date().getFullYear();

  // construct password
  const password = `${prefix}${lastThreeDigits}@${currentYear}`;

  return password;
}

// ✅ Get teachers by student level + medium
router.get("/teachers", async (req, res) => {
  try {
    const { level, medium } = req.query;

    if (!level || !medium) {
      return res.status(400).json({ msg: "Level and medium are required" });
    }

    // 1️⃣ Find the course for this level
    const course = await Course.findOne({ title: level }); // assuming title = level like "A1"
    if (!course) {
      return res.status(404).json({ msg: "No course found for this level" });
    }

    // 2️⃣ Find teachers (including TEACHER_ADMIN) who teach this course & match medium
    const teachers = await User.find({
      role: { $in: ["TEACHER", "TEACHER_ADMIN"] },
      medium: { $in: [medium] },
      assignedCourses: course._id
    }).select("name email regNo medium assignedCourses");

    if (!teachers || teachers.length === 0) {
      return res.status(404).json({ msg: "No teachers found for this level and medium" });
    }

    res.json(teachers);
  } catch (err) {
    console.error("Error fetching teachers:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Get teachers by student medium
router.get("/teachersByMedium", async (req, res) => {
  try {
    const { medium } = req.query;

    if (!medium) {
      return res.status(400).json({ msg: "Medium is required" });
    }

    const teachers = await User.find({
      role: { $in: ["TEACHER", "TEACHER_ADMIN"] },
      medium: { $in: [medium] }
    }).select("name email regNo medium assignedCourses");

    if (!teachers || teachers.length === 0) {
      return res.status(404).json({ msg: "No teachers found for this medium" });
    }

    res.json(teachers);
  } catch (err) {
    console.error("Error fetching teachers:", err);
    res.status(500).json({ error: err.message });
  }
});


// ✅ Signup
router.post("/signup", async (req, res) => {
  try {
    const {
      name,
      email,
      role,
      subscription,
      level,
      batch,
      medium,
      studentStatus,
      assignedCourses,
      assignedBatches,
      assignedTeacher,
      phoneNumber,
      address,
      age,
      programEnrolled: servicesOpted,
      leadSource,
      languageLevelOpted,
      dateWithdrew,
      reasonForWithdrewing,
      courseCompletionDates,
      courseStartDates,
      qualifications
     } = req.body;

    const regNo = await generateRegNo(role);
    const password = await generatePassword(role, regNo); // generate random password

    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ msg: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    user = new User({
      regNo,   // <-- assign here
      name,
      email,
      password: hashedPassword,
      role,
    });

    if (user.role === "STUDENT") {
      user.subscription = subscription;
      user.level = level;
      user.batch = batch;
      user.medium = medium;
      user.studentStatus = studentStatus;
      user.phoneNumber = phoneNumber;
      user.address = address;
      user.age = age;
      user.servicesOpted = servicesOpted;
      user.leadSource = leadSource;
      user.languageLevelOpted = languageLevelOpted;
      user.dateWithdrew = dateWithdrew;
      user.reasonForWithdrawing = reasonForWithdrewing;
      user.courseCompletionDates = courseCompletionDates;
      user.courseStartDates = courseStartDates;
      user.qualifications = qualifications;

      // ✅ Auto-set start date for current level if not provided
      if (!user.courseStartDates) {
        user.courseStartDates = {};
      }
      const levelStartField = `${level}StartDate`;
      if (!user.courseStartDates[levelStartField]) {
        user.courseStartDates[levelStartField] = new Date();
      }

      // 🔍 Teacher assignment
      if (assignedTeacher) {
        // case 1: frontend provided teacher id
        user.assignedTeacher = assignedTeacher;
      } else {
        // case 2: backend finds one automatically
        const course = await Course.findOne({ level });
        if (!course) {
          return res.status(400).json({ msg: "No course found for this level" });
        }

        const teacher = await User.findOne({
          role: "TEACHER",
          medium: { $in: [medium] },
          assignedCourses: course._id
        });

        if (teacher) {
          user.assignedTeacher = teacher._id;
        } else {
          return res.status(400).json({ msg: "No teacher found for this level and medium" });
        }
      }
    }

    else if (user.role === "TEACHER") {
      user.assignedBatches = assignedBatches;
      user.medium = medium;
      user.assignedCourses = assignedCourses; // Assign courses if provided
    }

    await user.save();

    // ✉️ Send email
    const passwordPlain = password; // Store plain password temporarily for email


    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: "Welcome to Glück Global Student Portal 🎉",
      html: `
        <div style="font-family: Arial, sans-serif; color: #000000; line-height: 1.6;">
          <p>Hello ${user.name},</p>

          <p>You have successfully registered to the <strong>Glück Global Student Portal</strong>. Here are your login credentials:</p>

          <ul>
            <li><strong>Web App ID:</strong> ${user.regNo}</li>
            <li><strong>Password:</strong> ${passwordPlain}</li>
          </ul>

          <p>Please keep this information safe and do not share it with anyone.</p>

          <p>You can access the Portal at: <a href="https://gluckstudentsportal.com" target="_blank">https://gluckstudentsportal.com</a></p>

          <p>Best regards,<br>
          <strong>Glück Global Pvt Ltd</strong></p>
        </div>
      `
    };


    try {
      await transporter.sendMail(mailOptions);
      console.log("✅ Email sent to", user.email);

      // Update lastCredentialsEmailSent timestamp
      user.lastCredentialsEmailSent = new Date();
      await user.save();
    } catch (err) {
      console.error("❌ Email sending failed:", err);
  }

    res.status(201).json({ msg: "User created successfully", user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ✅ Login
router.post("/login", async (req, res) => {
  try {
    const { regNo, password } = req.body;

    const user = await User.findOne({ regNo });
    if (!user) return res.status(400).json({ msg: "Invalid credentials" });

    // 🔴 BLOCK WITHDREW STUDENTS
    if (user.role === "STUDENT" && user.studentStatus === "WITHDREW") {
      return res.status(403).json({
        msg: "Your student account has been withdrawn. Access denied."
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: "Invalid credentials" });

    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
        name: user.name
      },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    // ✅ Set cookie instead of sending token
    res.cookie("authToken", token, {
      httpOnly: true,
      secure: false,   // ✅ FIXED: false in development
      sameSite: 'Lax', // ✅ FIXED: 'Lax' for localhost
      path: '/',
      maxAge: 60 * 60 * 1000 // 1 hour
    });

    // ✅ Send user info only (no token in response)
    return res.json({
      user: {
        name: user.name,
        email: user.email,
        role: user.role,
        subscription: user.subscription,
        profilePhoto: user.profilePhoto || null
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ✅ Logout
router.post("/logout", (req, res) => {
  res.clearCookie("authToken", {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // ✅ true in production with HTTPS
    sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax', // ✅ FIXED: Match login settings
    domain: process.env.NODE_ENV === 'production' ? '.gluckstudentsportal.com' : undefined, // ✅ FIXED: Match login settings
    path: '/' // ✅ FIXED: Match login settings
  });
  return res.json({ msg: "Logged out successfully" });
});


// ✅ Profile route
router.get("/profile", verifyToken, async (req, res) => {
  try {
    let query = User.findById(req.user.id).select("-password");

    // If the logged-in user is a student → populate teacher info
    if (req.user.role === "STUDENT") {
      query = query.populate("assignedTeacher", "name email");
      // 👆 populate assignedTeacher with only name & email fields
    }

    const user = await query;

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (err) {
    console.error("Error fetching profile:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ Get all teachers and admins for role management (MUST be before /:id route)
router.get("/teachers-and-admins", verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const users = await User.find({
      role: { $in: ['TEACHER', 'TEACHER_ADMIN', 'ADMIN'] }
    }).select("name email regNo role").sort({ role: 1, name: 1 });

    res.status(200).json(users);
  } catch (error) {
    console.error("❌ Error fetching teachers and admins:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

// ✅ Get a user by ID
router.get("/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    res.status(200).json(user);
  } catch (error) {
    console.error("❌ Error fetching user:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

// ✅ Get teachers by batch
router.get("/teachers-by-batch/:batch", async (req, res) => {
  try {
    const batch = req.params.batch;
    console.log("🔍 Fetching teachers for batch:", batch);

    if (!batch) {
      return res.status(400).json({ message: "Batch is required." });
    }

    const teachers = await User.find({
      role: { $in: ["TEACHER", "TEACHER_ADMIN"] },
      assignedBatches: { $in: [batch] }
    }).select("name");

    teachers.forEach(teacher => {
      console.log("👨‍🏫 Found teacher:", teacher.name);
    });

    // ✅ Always return 200 with array
    res.status(200).json(teachers);

  } catch (error) {
    console.error("❌ Error fetching teachers by batch:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});


// Update assigned teacher by batch
router.put("/update-teacher-by-batch", async (req, res) => {
  try {
    const { batch, newTeacherId } = req.body;

    if (!batch || !newTeacherId) {
      return res.status(400).json({
        message: "Batch and newTeacherId are required."
      });
    }

    const students = await User.find({
      role: "STUDENT",
      batch: batch
    });

    if (students.length === 0) {
      return res.status(404).json({
        message: "No students found for the specified batch."
      });
    }

    const logs = students.map(student => ({
      action: "UPDATE",
      studentId: student._id,
      levelAtUpdate: student.level,
      batchAtUpdate: student.batch,
      assignedTeacherAtUpdate: student.assignedTeacher,
      statusAtUpdate: student.studentStatus,
      subscriptionAtUpdate: student.subscription,
      mediumAtUpdate: student.medium
    }));

    await StudentLogs.insertMany(logs);
    console.log(`✅ Created ${logs.length} student log entries for teacher update by batch.`);

    const result = await User.updateMany(
      { role: "STUDENT", batch: batch },
      { assignedTeacher: newTeacherId }
    );

    res.status(200).json({
      message: `Assigned teacher updated for ${result.nModified} students.`
    });

  } catch (error) {
    res.status(500).json({ message: "Internal server error." });
  }
});


// ✅ Update user by ID
router.put("/:id", async (req, res) => {
  try {
    // 1️⃣ Get existing user (OLD data)
    const existingUser = await User.findById(req.params.id);

    if (!existingUser) {
      return res.status(404).json({ message: "User not found." });
    }

    // 2️⃣ Log OLD data into StudentLogs (if STUDENT)
    if (existingUser.role === "STUDENT") {
      const logEntry = new StudentLogs({
        action: "UPDATE",
        studentId: existingUser._id,
        levelAtUpdate: existingUser.level,
        batchAtUpdate: existingUser.batch,
        assignedTeacherAtUpdate: existingUser.assignedTeacher,
        statusAtUpdate: existingUser.studentStatus,
        subscriptionAtUpdate: existingUser.subscription,
        mediumAtUpdate: existingUser.medium
      });

      await logEntry.save();
    }

    // 3️⃣ Extract NEW data
    const {
      name,
      email,
      role,
      subscription,
      level,
      batch,
      medium,
      assignedCourses,
      assignedTeacher,
      assignedBatches,
      studentStatus,
      phoneNumber,
      address,
      age,
      programEnrolled: servicesOpted,
      leadSource,
      languageLevelOpted,
      dateWithdrew,
      courseCompletionDates,
      courseStartDates,
      reasonForWithdrawing,
      qualifications
    } = req.body;

    // 4️⃣ Build update object
    const updateData = {
      name,
      email,
      role,
      subscription,
      level,
      batch,
      medium,
      assignedCourses,
      assignedTeacher,
      assignedBatches,
      studentStatus,
      phoneNumber,
      address,
      age,
      servicesOpted,
      leadSource,
      languageLevelOpted,
      dateWithdrew,
      reasonForWithdrawing,
      courseCompletionDates,
      courseStartDates,
      qualifications
    };

    // ✅ Auto-set start date for new level if level changed and start date not set
    if (existingUser.role === "STUDENT" && level && level !== existingUser.level) {
      if (!updateData.courseStartDates) {
        updateData.courseStartDates = existingUser.courseStartDates || {};
      }
      const levelStartField = `${level}StartDate`;
      if (!updateData.courseStartDates[levelStartField]) {
        updateData.courseStartDates[levelStartField] = new Date();
      }
    }

    // 5️⃣ Clear withdraw data if not withdrew
    if (studentStatus !== "WITHDREW") {
      updateData.dateWithdrew = null;
      updateData.reasonForWithdrawing = "";
    }

    // 6️⃣ Update user
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    res.status(200).json({
      message: "User updated successfully.",
      data: updatedUser
    });

  } catch (error) {
    console.error("Update error:", error);

    // ✅ Handle duplicate key error specifically
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        message: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists. Please use a different ${field}.`
      });
    }

    res.status(500).json({ message: "Internal server error." });
  }
});


// ✅ Delete user by ID
router.delete("/:id", async (req, res) => {
  try {
    const deletedUser = await User.findByIdAndDelete(req.params.id);

    if (!deletedUser) {
      return res.status(404).json({ message: "User not found." });
    }
    res.status(200).json({ message: "User deleted successfully." });
  } catch (error) {
    res.status(500).json({ message: "Internal server error." });
  }
});

// ✅ Resend credentials email to a student
router.post("/resend-credentials/:userId", verifyToken, checkRole('ADMIN'), async (req, res) => {
  try {
    const userId = req.params.userId;

    // Find the user
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    // Only allow for students
    if (user.role !== "STUDENT") {
      return res.status(400).json({ msg: "Credentials can only be resent to students" });
    }

    // Generate a new password
    const passwordPlain = await generatePassword(user.role, user.regNo);
    const hashedPassword = await bcrypt.hash(passwordPlain, 10);

    // Update user password and email sent timestamp
    user.password = hashedPassword;
    user.lastCredentialsEmailSent = new Date();
    await user.save();

    // Send email with credentials
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: "Your Glück Global Student Portal Credentials 🎉",
      html: `
        <div style="font-family: Arial, sans-serif; color: #000000; line-height: 1.6;">
          <p>Hello ${user.name},</p>

          <p>As requested, here are your login credentials for the <strong>Glück Global Student Portal</strong>:</p>

          <ul>
            <li><strong>Web App ID:</strong> ${user.regNo}</li>
            <li><strong>Password:</strong> ${passwordPlain}</li>
          </ul>

          <p>Please keep this information safe and do not share it with anyone.</p>

          <p>You can access the Portal at: <a href="https://gluckstudentsportal.com" target="_blank">https://gluckstudentsportal.com</a></p>

          <p>Best regards,<br>
          <strong>Glück Global Pvt Ltd</strong></p>
        </div>
      `
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log("✅ Credentials email resent to", user.email);

      res.json({
        success: true,
        msg: "Credentials email sent successfully",
        lastSent: user.lastCredentialsEmailSent
      });
    } catch (emailErr) {
      console.error("❌ Email sending failed:", emailErr);
      res.status(500).json({
        success: false,
        msg: "Failed to send email. Please try again."
      });
    }

  } catch (err) {
    console.error("Error resending credentials:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Protected role-based routes
router.get("/protected", verifyToken, (req, res) => {
  res.json({ msg: "You have access!", user: req.user });
});

router.get("/admin-dashboard", verifyToken, checkRole('ADMIN'), (req, res) => {
  res.json({ msg: "Welcome to the admin dashboard" });
});

router.get("/teacher-dashboard", verifyToken, checkRole('TEACHER'), (req, res) => {
  res.json({ msg: "Welcome to the teacher dashboard" });
});

router.get("/student-dashboard", verifyToken, checkRole('STUDENT'), (req, res) => {
  res.json({ msg: "Welcome to the student dashboard" });
});

// ✅ NEW: Get users by role (for unified user management)
router.get("/users-by-role/:role", verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { role } = req.params;

    // Validate role
    if (!['ADMIN', 'TEACHER', 'STUDENT'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role specified' });
    }

    const users = await User.find({ role })
      .select('-password')
      .populate('assignedCourses', 'title')
      .sort({ createdAt: -1 });

    res.json(users);
  } catch (error) {
    console.error('Error fetching users by role:', error);
    res.status(500).json({ message: 'Error fetching users' });
  }
});

// ✅ NEW: Bulk upload students
router.post("/bulk-upload-students", verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { students, sendEmails = true } = req.body;

    if (!students || !Array.isArray(students) || students.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Students array is required and must not be empty'
      });
    }

    const results = {
      successful: [],
      failed: [],
      skipped: []
    };

    for (let i = 0; i < students.length; i++) {
      const student = students[i];
      const rowNumber = i + 2; // +2 because row 1 is header, and array is 0-indexed

      try {
        // Validate required fields
        if (!student.name || !student.name.trim()) {
          results.failed.push({
            row: rowNumber,
            data: student,
            reason: 'Name is required'
          });
          continue;
        }

        if (!student.email || !student.email.trim()) {
          results.failed.push({
            row: rowNumber,
            data: student,
            reason: 'Email is required'
          });
          continue;
        }

        if (!student.subscription || !['SILVER', 'PLATINUM'].includes(student.subscription.toUpperCase())) {
          results.failed.push({
            row: rowNumber,
            data: student,
            reason: 'Subscription must be SILVER or PLATINUM'
          });
          continue;
        }

        if (!student.level || !['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(student.level.toUpperCase())) {
          results.failed.push({
            row: rowNumber,
            data: student,
            reason: 'Level must be A1, A2, B1, B2, C1, or C2'
          });
          continue;
        }

        if (!student.studentStatus || !student.studentStatus.trim()) {
          results.failed.push({
            row: rowNumber,
            data: student,
            reason: 'Student Status is required'
          });
          continue;
        }

        // Check if email already exists
        const existingUser = await User.findOne({ email: student.email.trim().toLowerCase() });
        if (existingUser) {
          // ✅ RESEND CREDENTIALS instead of skipping
          if (sendEmails) {
            try {
              // Generate new password for existing user
              const newPasswordPlain = await generatePassword("STUDENT", existingUser.regNo);
              const newHashedPassword = await bcrypt.hash(newPasswordPlain, 10);

              // Update password
              existingUser.password = newHashedPassword;
              existingUser.lastCredentialsEmailSent = new Date();
              await existingUser.save();

              // Send credentials email
              await transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: existingUser.email,
                subject: "Your Glück Global Student Portal Credentials 🔑",
                html: `
                  <div style="font-family: Arial, sans-serif; color: #000000; line-height: 1.6;">
                    <p>Hello ${existingUser.name},</p>

                    <p>Your login credentials for the <strong>Glück Global Student Portal</strong> have been sent as requested:</p>

                    <ul>
                      <li><strong>Web App ID:</strong> ${existingUser.regNo}</li>
                      <li><strong>Password:</strong> ${newPasswordPlain}</li>
                    </ul>

                    <p>Please keep this information safe and do not share it with anyone.</p>

                    <p>You can access the Portal at: <a href="https://gluckstudentsportal.com" target="_blank">https://gluckstudentsportal.com</a></p>

                    <p>Best regards,<br>
                    <strong>Glück Global Pvt Ltd</strong></p>
                  </div>
                `
              });

              results.successful.push({
                row: rowNumber,
                name: existingUser.name,
                email: existingUser.email,
                regNo: existingUser.regNo,
                password: newPasswordPlain,
                emailSent: true,
                isExistingUser: true,
                action: 'credentials_resent'
              });
            } catch (emailError) {
              console.error(`Email error for existing user ${existingUser.email}:`, emailError);
              results.failed.push({
                row: rowNumber,
                data: student,
                reason: `Failed to resend credentials: ${emailError.message}`,
                existingRegNo: existingUser.regNo
              });
            }
          } else {
            // If sendEmails is false, just skip
            results.skipped.push({
              row: rowNumber,
              data: student,
              reason: 'Email already exists (credentials not resent because sendEmails=false)',
              existingRegNo: existingUser.regNo
            });
          }
          continue;
        }

        // Generate RegNo and Password
        const regNo = await generateRegNo("STUDENT");
        const passwordPlain = await generatePassword("STUDENT", regNo);
        const hashedPassword = await bcrypt.hash(passwordPlain, 10);

        // Create new user
        const newUser = new User({
          name: student.name.trim(),
          email: student.email.trim().toLowerCase(),
          regNo,
          password: hashedPassword,
          role: "STUDENT",
          subscription: student.subscription.toUpperCase(),
          level: student.level.toUpperCase(),
          studentStatus: student.studentStatus.trim(),
          medium: student.medium ? student.medium.trim() : undefined,
          batch: student.batch ? student.batch.trim() : undefined,
          phoneNumber: student.phoneNumber ? student.phoneNumber.trim() : undefined,
          address: student.address ? student.address.trim() : undefined,
          age: student.age ? parseInt(student.age) : undefined,
          servicesOpted: student.programEnrolled ? student.programEnrolled.trim() : (student.servicesOpted ? student.servicesOpted.trim() : undefined),
          leadSource: student.leadSource ? student.leadSource.trim() : undefined
        });

        // ✅ Auto-set start date for current level
        const level = student.level.toUpperCase();
        if (!newUser.courseStartDates) {
          newUser.courseStartDates = {};
        }
        const levelStartField = `${level}StartDate`;
        newUser.courseStartDates[levelStartField] = new Date();

        await newUser.save();

        // Send welcome email if requested
        if (sendEmails) {
          try {
            await transporter.sendMail({
              from: process.env.EMAIL_USER,
              to: newUser.email,
              subject: "Welcome to Glück Global Student Portal 🎉",
              html: `
                <div style="font-family: Arial, sans-serif; color: #000000; line-height: 1.6;">
                  <p>Hello ${newUser.name},</p>

                  <p>You have successfully registered to the <strong>Glück Global Student Portal</strong>. Here are your login credentials:</p>

                  <ul>
                    <li><strong>Web App ID:</strong> ${regNo}</li>
                    <li><strong>Password:</strong> ${passwordPlain}</li>
                  </ul>

                  <p>Please keep this information safe and do not share it with anyone.</p>

                  <p>You can access the Portal at: <a href="https://gluckstudentsportal.com" target="_blank">https://gluckstudentsportal.com</a></p>

                  <p>Best regards,<br>
                  <strong>Glück Global Pvt Ltd</strong></p>
                </div>
              `
            });

            // Update lastCredentialsEmailSent timestamp
            newUser.lastCredentialsEmailSent = new Date();
            await newUser.save();

            results.successful.push({
              row: rowNumber,
              name: newUser.name,
              email: newUser.email,
              regNo: newUser.regNo,
              password: passwordPlain,
              emailSent: true
            });
          } catch (emailError) {
            console.error(`Email error for ${newUser.email}:`, emailError);
            results.successful.push({
              row: rowNumber,
              name: newUser.name,
              email: newUser.email,
              regNo: newUser.regNo,
              password: passwordPlain,
              emailSent: false,
              emailError: 'Failed to send email'
            });
          }
        } else {
          results.successful.push({
            row: rowNumber,
            name: newUser.name,
            email: newUser.email,
            regNo: newUser.regNo,
            password: passwordPlain,
            emailSent: false
          });
        }

      } catch (error) {
        console.error(`Error processing student at row ${rowNumber}:`, error);
        results.failed.push({
          row: rowNumber,
          data: student,
          reason: error.message || 'Unknown error'
        });
      }
    }

    // Return summary
    res.json({
      success: true,
      message: 'Bulk upload completed',
      summary: {
        total: students.length,
        successful: results.successful.length,
        failed: results.failed.length,
        skipped: results.skipped.length
      },
      results
    });

  } catch (error) {
    console.error('Bulk upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during bulk upload',
      error: error.message
    });
  }
});

module.exports = router;
