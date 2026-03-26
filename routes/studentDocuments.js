// routes/studentDocuments.js
// Routes for student document management

const express = require('express');
const router = express.Router();
const { verifyToken, checkRole } = require('../middleware/auth');
const upload = require('../config/documentUpload');
const StudentDocument = require('../models/StudentDocument');
const DocumentRequirement = require('../models/DocumentRequirement');
const User = require('../models/User');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Services that don't require any documents
const NO_DOCS_SERVICES = ['German Language Only', 'Language only', 'Only for language', 'None', ''];

// GET /api/student-documents/requirements - Get document requirements for the logged-in student
router.get('/requirements', verifyToken, checkRole(['STUDENT']), async (req, res) => {
  try {
    const student = await User.findById(req.user.id).select('servicesOpted').lean();
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const service = (student.servicesOpted || '').trim();

    // If student's service doesn't require documents, return empty
    if (!service || NO_DOCS_SERVICES.some(s => s.toLowerCase() === service.toLowerCase())) {
      return res.json({ success: true, requirements: [] });
    }

    // Fetch active requirements that apply to this student's service
    // Normalize: treat spaces and hyphens as interchangeable, case-insensitive
    const normalized = service.replace(/[\s\-]+/g, '[\\s\\-]*');
    const serviceRegex = new RegExp('^' + normalized + '$', 'i');
    const requirements = await DocumentRequirement.find({
      active: true,
      applicableServices: serviceRegex
    }).sort({ order: 1 }).lean();

    // Map to the shape the frontend expects
    const mapped = requirements.map(r => ({
      type: r.type,
      label: r.label,
      description: r.description,
      required: r.required,
      category: r.category
    }));

    res.json({ success: true, requirements: mapped });
  } catch (error) {
    console.error('❌ Error fetching document requirements:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching document requirements',
      error: error.message
    });
  }
});

// GET /api/student-documents/my-documents - Get student's uploaded documents
router.get('/my-documents', verifyToken, checkRole(['STUDENT']), async (req, res) => {
  try {
    console.log('📂 Fetching documents for user:', req.user?.id);
    
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }
    
    const studentId = req.user.id;
    
    // Verify student exists
    const student = await User.findById(studentId);
    if (!student) {
      console.error('❌ Student not found in database:', studentId);
      return res.status(404).json({
        success: false,
        message: 'Student not found. Please log in again.'
      });
    }
    
    console.log('✅ Student found:', student.name);
    
    const documents = await StudentDocument.find({ studentId })
      .sort({ uploadedAt: -1 })
      .lean();
    
    // Add formatted file sizes
    const documentsWithFormatting = documents.map(doc => ({
      ...doc,
      formattedFileSize: formatFileSize(doc.fileSize),
      documentTypeDisplay: getDocumentTypeDisplayName(doc.documentType)
    }));
    
    res.json({
      success: true,
      documents: documentsWithFormatting,
      totalDocuments: documents.length
    });
  } catch (error) {
    console.error('❌ Error fetching student documents:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching documents',
      error: error.message
    });
  }
});

// POST /api/student-documents/upload - Upload a new document
router.post('/upload', verifyToken, checkRole(['STUDENT']), upload.single('document'), async (req, res) => {
  try {
    console.log('📤 Upload request received');
    console.log('👤 User from token:', req.user);
    console.log('📁 File:', req.file);
    console.log('📝 Body:', req.body);
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }
    
    const { documentType, documentName, description } = req.body;
    
    if (!documentType || !documentName) {
      // Delete uploaded file if validation fails
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({
        success: false,
        message: 'Document type and name are required'
      });
    }
    
    // Get student information
    const student = await User.findById(req.user.id);
    if (!student) {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }
    
    // Move file to student-specific folder if it was uploaded to temp
    let finalPath = req.file.path;
    if (req.file.path.includes('temp')) {
      const studentFolder = path.join('uploads/student-documents', req.user.id.toString());
      if (!fs.existsSync(studentFolder)) {
        fs.mkdirSync(studentFolder, { recursive: true });
      }
      finalPath = path.join(studentFolder, req.file.filename);
      fs.renameSync(req.file.path, finalPath);
    }
    
    // Create document record
    const document = new StudentDocument({
      studentId: req.user.id,
      studentName: student.name,
      studentEmail: student.email,
      documentType,
      documentName,
      fileName: req.file.filename,
      filePath: finalPath,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      description: description || '',
      status: 'PENDING'
    });
    
    await document.save();
    
    console.log(`✅ Document uploaded: ${documentName} by ${student.name}`);
    
    res.json({
      success: true,
      message: 'Document uploaded successfully',
      document: {
        ...document.toObject(),
        formattedFileSize: formatFileSize(document.fileSize),
        documentTypeDisplay: getDocumentTypeDisplayName(document.documentType)
      }
    });
  } catch (error) {
    console.error('❌ Error uploading document:', error);
    
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({
      success: false,
      message: 'Error uploading document',
      error: error.message
    });
  }
});

// DELETE /api/student-documents/:documentId - Delete a document
router.delete('/:documentId', verifyToken, checkRole(['STUDENT']), async (req, res) => {
  try {
    const { documentId } = req.params;
    const studentId = req.user.id;
    
    // Find document and verify ownership
    const document = await StudentDocument.findOne({
      _id: documentId,
      studentId: studentId
    });
    
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found or you do not have permission to delete it'
      });
    }
    
    // Prevent deletion of verified documents
    if (document.status === 'VERIFIED') {
      return res.status(403).json({
        success: false,
        message: 'Cannot delete verified documents. Please contact admin if you need to update this document.'
      });
    }
    
    // Delete physical file
    if (fs.existsSync(document.filePath)) {
      fs.unlinkSync(document.filePath);
    }
    
    // Delete database record
    await StudentDocument.deleteOne({ _id: documentId });
    
    console.log(`✅ Document deleted: ${document.documentName} by student ${studentId}`);
    
    res.json({
      success: true,
      message: 'Document deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting document:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting document',
      error: error.message
    });
  }
});

// GET /api/student-documents/download/:documentId - Download a document
router.get('/download/:documentId', verifyToken, checkRole(['STUDENT', 'TEACHER', 'ADMIN']), async (req, res) => {
  try {
    const { documentId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;
    
    // Find document
    const document = await StudentDocument.findById(documentId);
    
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }
    
    // Check permissions: students can only download their own documents
    if (userRole === 'STUDENT' && document.studentId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to download this document'
      });
    }
    
    // Check if this is a document marked as verified without file
    if (document.fileName === 'NO_FILE_UPLOADED' || document.filePath === 'NO_FILE_UPLOADED') {
      return res.status(404).json({
        success: false,
        message: 'This document was verified without file upload. No file is available for download.'
      });
    }
    
    // Check if file exists
    if (!fs.existsSync(document.filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File not found on server'
      });
    }
    
    // Send file
    res.download(document.filePath, document.fileName);
  } catch (error) {
    console.error('❌ Error downloading document:', error);
    res.status(500).json({
      success: false,
      message: 'Error downloading document',
      error: error.message
    });
  }
});

// GET /api/student-documents/preview/:documentId - Preview a document inline
router.get('/preview/:documentId', verifyToken, checkRole(['STUDENT', 'TEACHER', 'ADMIN']), async (req, res) => {
  try {
    const { documentId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;
    
    const document = await StudentDocument.findById(documentId);
    
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }
    
    if (userRole === 'STUDENT' && document.studentId.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Permission denied' });
    }
    
    if (document.fileName === 'NO_FILE_UPLOADED' || document.filePath === 'NO_FILE_UPLOADED') {
      return res.status(404).json({ success: false, message: 'No file available' });
    }
    
    if (!fs.existsSync(document.filePath)) {
      return res.status(404).json({ success: false, message: 'File not found on server' });
    }
    
    // Set content type and serve inline
    res.setHeader('Content-Type', document.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${document.fileName}"`);
    
    const fileStream = fs.createReadStream(document.filePath);
    fileStream.pipe(res);
  } catch (error) {
    console.error('❌ Error previewing document:', error);
    res.status(500).json({ success: false, message: 'Error previewing document' });
  }
});

// GET /api/student-documents/admin/all - Get all student documents (Admin only)
router.get('/admin/all', verifyToken, checkRole(['ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { studentId, status, documentType } = req.query;
    
    const filter = {};
    if (studentId) filter.studentId = studentId;
    if (status) filter.status = status;
    if (documentType) filter.documentType = documentType;
    
    const documents = await StudentDocument.find(filter)
      .populate('studentId', 'name email batch level servicesOpted')
      .sort({ uploadedAt: -1 })
      .lean();
    
    const documentsWithFormatting = documents.map(doc => ({
      ...doc,
      servicesOpted: doc.studentId?.servicesOpted || '',
      formattedFileSize: formatFileSize(doc.fileSize),
      documentTypeDisplay: getDocumentTypeDisplayName(doc.documentType)
    }));
    
    res.json({
      success: true,
      documents: documentsWithFormatting,
      totalDocuments: documents.length
    });
  } catch (error) {
    console.error('❌ Error fetching all documents:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching documents',
      error: error.message
    });
  }
});

// PUT /api/student-documents/admin/verify/:documentId - Verify/Reject a document (Admin only)
router.put('/admin/verify/:documentId', verifyToken, checkRole(['ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { documentId } = req.params;
    const { status, verificationNotes } = req.body;
    
    if (!['VERIFIED', 'REJECTED'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be VERIFIED or REJECTED'
      });
    }
    
    const document = await StudentDocument.findByIdAndUpdate(
      documentId,
      {
        status,
        verifiedBy: req.user.id,
        verifiedAt: new Date(),
        verificationNotes: verificationNotes || ''
      },
      { new: true }
    );
    
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }
    
    console.log(`✅ Document ${status.toLowerCase()}: ${document.documentName}`);
    
    res.json({
      success: true,
      message: `Document ${status.toLowerCase()} successfully`,
      document
    });
  } catch (error) {
    console.error('❌ Error verifying document:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying document',
      error: error.message
    });
  }
});

// POST /api/student-documents/admin/upload - Admin uploads document for student (Admin only)
router.post('/admin/upload', verifyToken, checkRole(['ADMIN']), upload.single('document'), async (req, res) => {
  try {
    console.log('📤 Admin bulk upload request');
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }
    
    const { studentEmail, documentType, documentName, description } = req.body;
    
    if (!studentEmail || !documentType || !documentName) {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({
        success: false,
        message: 'Student email, document type, and name are required'
      });
    }
    
    // Find student by email
    const student = await User.findOne({ email: studentEmail, role: 'STUDENT' });
    if (!student) {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({
        success: false,
        message: 'Student not found with this email'
      });
    }
    
    // Move file to student-specific folder
    const studentFolder = path.join('uploads/student-documents', student._id.toString());
    if (!fs.existsSync(studentFolder)) {
      fs.mkdirSync(studentFolder, { recursive: true });
    }
    
    const finalPath = path.join(studentFolder, req.file.filename);
    if (req.file.path !== finalPath) {
      fs.renameSync(req.file.path, finalPath);
    }
    
    // Create document record
    const document = new StudentDocument({
      studentId: student._id,
      studentName: student.name,
      studentEmail: student.email,
      documentType,
      documentName,
      fileName: req.file.filename,
      filePath: finalPath,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      description: description || 'Uploaded by admin',
      status: 'PENDING'
    });
    
    await document.save();
    
    console.log(`✅ Admin uploaded document: ${documentName} for ${student.name}`);
    
    res.json({
      success: true,
      message: 'Document uploaded successfully',
      document: {
        ...document.toObject(),
        formattedFileSize: formatFileSize(document.fileSize),
        documentTypeDisplay: getDocumentTypeDisplayName(document.documentType)
      }
    });
  } catch (error) {
    console.error('❌ Error in admin upload:', error);
    
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({
      success: false,
      message: 'Error uploading document',
      error: error.message
    });
  }
});

// POST /api/student-documents/admin/mark-verified - Mark document as verified without file upload (Admin only)
router.post('/admin/mark-verified', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    console.log('✅ Admin marking document as verified without upload');
    
    const { studentEmail, documentType, documentName, verificationNotes } = req.body;
    
    if (!studentEmail || !documentType || !documentName) {
      return res.status(400).json({
        success: false,
        message: 'Student email, document type, and document name are required'
      });
    }
    
    // Find student by email
    const student = await User.findOne({ email: studentEmail, role: 'STUDENT' });
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found with this email'
      });
    }
    
    // Create document record with VERIFIED status and no file
    const document = new StudentDocument({
      studentId: student._id,
      studentName: student.name,
      studentEmail: student.email,
      documentType,
      documentName,
      fileName: 'NO_FILE_UPLOADED',
      filePath: 'NO_FILE_UPLOADED',
      fileSize: 0,
      mimeType: 'application/octet-stream',
      description: 'Document verified without file upload - collected physically or through other means',
      status: 'VERIFIED',
      verifiedBy: req.user.id,
      verifiedAt: new Date(),
      verificationNotes: verificationNotes || 'Document verified without file upload'
    });
    
    await document.save();
    
    console.log(`✅ Admin marked document as verified: ${documentName} for ${student.name}`);
    
    res.json({
      success: true,
      message: 'Document marked as verified successfully',
      document: {
        ...document.toObject(),
        formattedFileSize: 'N/A',
        documentTypeDisplay: getDocumentTypeDisplayName(document.documentType)
      }
    });
  } catch (error) {
    console.error('❌ Error marking document as verified:', error);
    
    res.status(500).json({
      success: false,
      message: 'Error marking document as verified',
      error: error.message
    });
  }
});

// GET /api/student-documents/stats - Get document upload statistics
router.get('/stats', verifyToken, checkRole(['STUDENT']), async (req, res) => {
  try {
    console.log('📊 Fetching stats for user:', req.user?.id);
    
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }
    
    const studentId = req.user.id;
    
    // Verify student exists
    const student = await User.findById(studentId);
    if (!student) {
      console.error('❌ Student not found in database:', studentId);
      return res.status(404).json({
        success: false,
        message: 'Student not found. Please log in again.'
      });
    }
    
    const totalDocuments = await StudentDocument.countDocuments({ studentId });
    const verifiedDocuments = await StudentDocument.countDocuments({ studentId, status: 'VERIFIED' });
    const pendingDocuments = await StudentDocument.countDocuments({ studentId, status: 'PENDING' });
    const rejectedDocuments = await StudentDocument.countDocuments({ studentId, status: 'REJECTED' });
    
    // Get document types uploaded - use new keyword for ObjectId
    const documentsByType = await StudentDocument.aggregate([
      { $match: { studentId: new mongoose.Types.ObjectId(studentId) } },
      { $group: { _id: '$documentType', count: { $sum: 1 } } }
    ]);
    
    // Get required documents filtered by student's service
    const service = (student.servicesOpted || '').trim();
    let requiredDocs = [];
    
    if (service && !NO_DOCS_SERVICES.some(s => s.toLowerCase() === service.toLowerCase())) {
      const normalized = service.replace(/[\s\-]+/g, '[\\s\\-]*');
      const serviceRegex = new RegExp('^' + normalized + '$', 'i');
      requiredDocs = await DocumentRequirement.find({
        active: true,
        required: true,
        applicableServices: serviceRegex
      }).lean();
    }
    
    const uploadedRequiredDocs = documentsByType.filter(d => 
      requiredDocs.some(r => r.type === d._id)
    ).length;
    
    res.json({
      success: true,
      stats: {
        totalDocuments,
        verifiedDocuments,
        pendingDocuments,
        rejectedDocuments,
        requiredDocumentsUploaded: uploadedRequiredDocs,
        totalRequiredDocuments: requiredDocs.length,
        completionPercentage: requiredDocs.length > 0 ? Math.round((uploadedRequiredDocs / requiredDocs.length) * 100) : 0
      }
    });
  } catch (error) {
    console.error('❌ Error fetching document stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching statistics',
      error: error.message
    });
  }
});

// Helper functions
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function getDocumentTypeDisplayName(type) {
  // For legacy types, provide display names; for new types, format the type key
  const displayNames = {
    'CV': 'CV',
    'O_LEVEL_CERTIFICATE': 'O Level Certificate',
    'A_LEVEL_CERTIFICATE': 'A Level Certificate',
    'BROWN_CERTIFICATE': 'Brown Certificate',
    'DEGREE_DIPLOMA': 'Degree / Diploma',
    'ACADEMIC_TRANSCRIPT': 'Academic Transcript',
    'PASSPORT': 'Passport',
    'EXPERIENCE_LETTER': 'Experience Letter',
    'LANGUAGE_CERTIFICATE': 'Language Certificate',
    'EXTRACURRICULAR_CERTIFICATE': 'Extra-curricular Certificate',
    'AFFIDAVIT': 'Affidavit',
    'POLICE_CLEARANCE': 'Police Clearance',
    'OTHER': 'Other Document'
  };
  if (displayNames[type]) return displayNames[type];
  // Convert TYPE_KEY to Title Case
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// POST /api/student-documents/admin/send-email - Send custom email to a student (Admin only)
router.post('/admin/send-email', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { to, subject, message } = req.body;
    if (!to || !subject || !message) {
      return res.status(400).json({ success: false, message: 'to, subject, and message are required' });
    }

    const transporter = require('../config/emailConfig');
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1a237e; color: white; padding: 20px; text-align: center;">
            <h2>Glück Global</h2>
          </div>
          <div style="padding: 20px; background: #f5f5f5;">
            <div style="white-space: pre-wrap;">${message}</div>
          </div>
          <div style="padding: 10px; text-align: center; color: #666; font-size: 12px;">
            <p>Glück Global Language School</p>
          </div>
        </div>
      `
    });

    res.json({ success: true, message: 'Email sent successfully' });
  } catch (error) {
    console.error('❌ Error sending email:', error.message);
    res.status(500).json({ success: false, message: 'Failed to send email' });
  }
});

module.exports = router;
