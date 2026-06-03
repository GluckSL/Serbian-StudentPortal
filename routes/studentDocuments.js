// routes/studentDocuments.js
// Routes for student document management

const express = require('express');
const router = express.Router();
const { verifyToken, verifyMediaToken, checkRole } = require('../middleware/auth');
const upload = require('../config/documentUpload');
const StudentDocument = require('../models/StudentDocument');
const DocumentRequirement = require('../models/DocumentRequirement');
const User = require('../models/User');
const mongoose = require('mongoose');
const deleteFromS3 = require('../config/s3Delete');
const s3Client = require('../config/s3');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { processSingleDocument } = require('../services/ocrService');

// Services that don't require any documents
const NO_DOCS_SERVICES = ['German Language Only', 'Language only', 'Only for language', 'None', ''];

const DEFAULT_REQUIREMENTS = [
  { type: 'MISCELLANEOUS', name: 'Other Certificates', category: 'OTHER', allowMultiple: false, isRequired: true, order: 1 },
  { type: 'BIRTH_CERTIFICATE', name: 'Birth Certificate', category: 'IDENTIFICATION', allowMultiple: false, isRequired: true, order: 2 },
  { type: 'EXTRACURRICULAR_CERTIFICATE', name: 'Extra-curricular Certificate', category: 'ACADEMIC', allowMultiple: true, isRequired: true, order: 3 },
  { type: 'EXPERIENCE_LETTER', name: 'Work Related Certificate', category: 'PROFESSIONAL', allowMultiple: false, isRequired: true, order: 4 },
  { type: 'LANGUAGE_CERTIFICATE', name: 'Language Certificate', category: 'ACADEMIC', allowMultiple: false, isRequired: true, order: 5 },
  { type: 'PASSPORT', name: 'Passport Copy', category: 'IDENTIFICATION', allowMultiple: false, isRequired: true, order: 6 },
  { type: 'ACADEMIC_TRANSCRIPT', name: 'Degree Transcript', category: 'ACADEMIC', allowMultiple: false, isRequired: true, order: 7 },
  { type: 'A_LEVEL_CERTIFICATE', name: 'A/L Certificate', category: 'ACADEMIC', allowMultiple: false, isRequired: true, order: 8 },
  { type: 'CV', name: 'CV', category: 'PROFESSIONAL', allowMultiple: false, isRequired: true, order: 9 }
];

// GET /api/student-documents/requirements - Get document requirements for the logged-in student
router.get('/requirements', verifyToken, checkRole(['STUDENT']), async (req, res) => {
  try {
    await ensureDefaultRequirementsSeeded();

    const student = await User.findById(req.user.id).select('servicesOpted').lean();
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const service = (student.servicesOpted || '').trim();
    // Show every active document type to all students; required flag stays program-specific.
    const requirements = await getAllActiveRequirementsForStudent(service);

    // Map to the shape the frontend expects
    const mapped = requirements.map(mapRequirement);

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
    
    const documents = await StudentDocument.find({ studentId, isCurrent: true })
      .populate('documentTypeId', 'type name label category allowMultiple required isRequired')
      .sort({ uploadedAt: -1 })
      .lean();
    
    // Add formatted file sizes
    const documentsWithFormatting = documents.map((doc) =>
      mapStudentDocument({
        ...doc,
        documentTypeDisplay: doc.documentTypeId?.name || doc.documentTypeDisplay || getDocumentTypeDisplayName(doc.documentType)
      })
    );
    
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
    
    const { documentTypeId, documentType, documentName, description } = req.body;
    
    if ((!documentTypeId && !documentType) || !documentName) {
      // Delete uploaded file from S3 if validation fails
      if (req.file) await deleteFromS3(req.file.key || req.file.location);
      return res.status(400).json({
        success: false,
        message: 'Document type and name are required'
      });
    }
    
    // Get student information
    const student = await User.findById(req.user.id);
    if (!student) {
      if (req.file) await deleteFromS3(req.file.key || req.file.location);
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }
    
    const requirement = await resolveDocumentRequirement({ documentTypeId, documentType });
    if (!requirement) {
      if (req.file) await deleteFromS3(req.file.key || req.file.location);
      return res.status(400).json({
        success: false,
        message: 'Invalid document type. Uploads must match predefined document types.'
      });
    }

    const canonicalType = requirement.type;
    const latestVersion = await StudentDocument.findOne({
      studentId: req.user.id,
      documentTypeId: requirement._id
    }).sort({ version: -1 }).lean();
    const nextVersion = latestVersion ? Number(latestVersion.version || 1) + 1 : 1;

    if (!requirement.allowMultiple) {
      await StudentDocument.updateMany(
        { studentId: req.user.id, documentTypeId: requirement._id, isCurrent: true },
        { $set: { isCurrent: false, replacedAt: new Date(), replacedBy: req.user.id } }
      );
    }

    // Create document record — filePath stores the S3 URL
    const document = new StudentDocument({
      studentId: req.user.id,
      studentName: student.name,
      studentEmail: student.email,
      documentTypeId: requirement._id,
      documentType: canonicalType,
      documentName,
      documentCategory: requirement.category || 'OTHER',
      fileName: req.file.originalname,
      filePath: req.file.location,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      description: description || '',
      status: 'PENDING',
      version: nextVersion,
      isCurrent: true
    });
    
    await document.save();

    processSingleDocument(document.toObject()).catch(err =>
      console.error(`[OCR] Background processing failed for ${document._id}:`, err.message)
    );

    console.log(`✅ Document uploaded: ${documentName} by ${student.name}`);
    
    res.json({
      success: true,
      message: 'Document uploaded successfully',
      document: mapStudentDocument({
        ...document.toObject(),
        documentTypeDisplay: requirement.name || requirement.label || getDocumentTypeDisplayName(document.documentType)
      })
    });
  } catch (error) {
    console.error('❌ Error uploading document:', error);
    
    // Clean up uploaded file from S3 on error
    if (req.file) await deleteFromS3(req.file.key || req.file.location).catch(() => {});
    
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
      studentId: studentId,
      isCurrent: true
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
    
    // Delete file from S3 (filePath is now an S3 URL)
    if (document.filePath && document.filePath !== 'NO_FILE_UPLOADED') {
      await deleteFromS3(document.filePath);
    }
    
    // Delete database record (only current student-owned docs are allowed to be deleted)
    await StudentDocument.deleteOne({ _id: documentId, isCurrent: true });
    
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
router.get('/download/:documentId', verifyMediaToken, checkRole(['STUDENT', 'TEACHER', 'ADMIN']), async (req, res) => {
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
    
    if (!document.filePath) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    const signedUrl = await createSignedS3Url(document.filePath, {
      responseContentDisposition: `attachment; filename="${sanitizeDownloadFilename(document.fileName || document.documentName || 'document')}"`,
      responseContentType: document.mimeType || undefined
    });

    if (!signedUrl) {
      return res.status(500).json({
        success: false,
        message: 'File is stored privately but could not generate a secure download link'
      });
    }

    res.redirect(signedUrl);
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
router.get('/preview/:documentId', verifyMediaToken, checkRole(['STUDENT', 'TEACHER', 'ADMIN']), async (req, res) => {
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
    
    if (!document.filePath) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    
    const signedUrl = await createSignedS3Url(document.filePath, {
      responseContentDisposition: `inline; filename="${sanitizeDownloadFilename(document.fileName || document.documentName || 'document')}"`,
      responseContentType: document.mimeType || undefined
    });

    if (!signedUrl) {
      return res.status(500).json({
        success: false,
        message: 'File is stored privately but could not generate a secure preview link'
      });
    }

    // Redirect to signed URL for inline preview
    res.redirect(signedUrl);
  } catch (error) {
    console.error('❌ Error previewing document:', error);
    res.status(500).json({ success: false, message: 'Error previewing document' });
  }
});

// GET /api/student-documents/admin/all - Get all student documents (Admin only)
router.get('/admin/all', verifyToken, checkRole(['ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { studentId, status, documentType, includeHistory } = req.query;
    
    const filter = includeHistory === 'true' ? {} : { isCurrent: true };
    if (studentId) filter.studentId = studentId;
    if (status) filter.status = status;
    if (documentType) filter.documentType = documentType;
    
    const documents = await StudentDocument.find(filter)
      .populate('documentTypeId', 'type name label category allowMultiple required isRequired')
      .populate(
        'studentId',
        'name email regNo batch level subscription studentStatus qualifications servicesOpted languageLevelOpted'
      )
      .sort({ uploadedAt: -1 })
      .lean();
    
    const documentsWithFormatting = documents.map((doc) =>
      mapStudentDocument({
        ...doc,
        servicesOpted: doc.studentId?.servicesOpted || '',
        subscription: doc.studentId?.subscription || '',
        studentStatus: doc.studentId?.studentStatus || '',
        qualifications: doc.studentId?.qualifications || '',
        languageLevelOpted: doc.studentId?.languageLevelOpted || '',
        documentTypeDisplay: doc.documentTypeId?.name || getDocumentTypeDisplayName(doc.documentType)
      })
    );
    
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

// PUT /api/student-documents/admin/verify/:documentId - Update document status (Admin only)
router.put('/admin/verify/:documentId', verifyToken, checkRole(['ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { documentId } = req.params;
    const { status, verificationNotes } = req.body;
    
    if (!['PENDING', 'VERIFIED', 'REJECTED'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be PENDING, VERIFIED or REJECTED'
      });
    }
    
    const now = new Date();
    const updatePayload = {
      status,
      verificationNotes: verificationNotes || '',
      remarks: verificationNotes || ''
    };

    if (status === 'PENDING') {
      updatePayload.verifiedBy = null;
      updatePayload.verifiedAt = null;
    } else {
      updatePayload.verifiedBy = req.user.id;
      updatePayload.verifiedAt = now;
    }

    const document = await StudentDocument.findByIdAndUpdate(
      documentId,
      updatePayload,
      { new: true }
    );
    
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }
    
    console.log(`✅ Document ${status.toLowerCase()}: ${document.documentName}`);

    let emailSent = false;
    if (status === 'REJECTED' || status === 'VERIFIED') {
      try {
        const {
          sendDocumentReuploadEmail,
          sendDocumentApprovedEmail,
          isDocumentEmailConfigured
        } = require('../config/documentEmailConfig');
        if (isDocumentEmailConfigured()) {
          const isAgreement = document.documentCategory === 'AGREEMENT' || String(document.documentType || '').startsWith('AGREEMENT_');
          if (status === 'REJECTED') {
            emailSent = await sendDocumentReuploadEmail({
              studentName: document.studentName,
              studentEmail: document.studentEmail,
              documentName: document.documentName,
              reason: verificationNotes || document.remarks || '',
              isAgreement
            });
          } else {
            emailSent = await sendDocumentApprovedEmail({
              studentName: document.studentName,
              studentEmail: document.studentEmail,
              documentName: document.documentName,
              isAgreement
            });
          }
        }
      } catch (mailErr) {
        console.warn(`⚠️ ${status === 'REJECTED' ? 'Re-upload' : 'Approval'} email failed:`, mailErr.message);
      }
    }
    
    res.json({
      success: true,
      message: status === 'REJECTED'
        ? (emailSent ? 'Re-upload requested and email sent to student' : 'Re-upload requested (email not sent — check DOCS_EMAIL_* in .env)')
        : status === 'VERIFIED'
          ? (emailSent ? 'Approved and confirmation email sent to student' : 'Approved (email not sent — check DOCS_EMAIL_* in .env)')
          : `Document ${status.toLowerCase()} successfully`,
      document,
      emailSent
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

// POST /api/student-documents/admin/replace/:documentId - Replace an existing document with a new version (Admin only)
router.post('/admin/replace/:documentId', verifyToken, checkRole(['ADMIN', 'TEACHER']), upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No replacement file uploaded'
      });
    }

    const { documentId } = req.params;
    const targetDocument = await StudentDocument.findById(documentId).lean();
    if (!targetDocument) {
      if (req.file) await deleteFromS3(req.file.key || req.file.location).catch(() => {});
      return res.status(404).json({ success: false, message: 'Original document not found' });
    }

    const requirement = await resolveDocumentRequirement({
      documentTypeId: targetDocument.documentTypeId,
      documentType: targetDocument.documentType
    });

    if (!requirement) {
      if (req.file) await deleteFromS3(req.file.key || req.file.location).catch(() => {});
      return res.status(400).json({ success: false, message: 'Invalid document type mapping for original document' });
    }

    const latestVersion = await StudentDocument.findOne({
      studentId: targetDocument.studentId,
      documentTypeId: requirement._id
    }).sort({ version: -1 }).lean();
    const nextVersion = latestVersion ? Number(latestVersion.version || 1) + 1 : 1;

    await StudentDocument.updateMany(
      { studentId: targetDocument.studentId, documentTypeId: requirement._id, isCurrent: true },
      { $set: { isCurrent: false, replacedAt: new Date(), replacedBy: req.user.id } }
    );

    const replacement = await StudentDocument.create({
      studentId: targetDocument.studentId,
      studentName: targetDocument.studentName,
      studentEmail: targetDocument.studentEmail,
      documentTypeId: requirement._id,
      documentType: requirement.type,
      documentName: targetDocument.documentName,
      documentCategory: requirement.category || targetDocument.documentCategory || 'OTHER',
      fileName: req.file.originalname,
      filePath: req.file.location,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      description: `Replaced by admin. Previous version: ${targetDocument.version || 1}`,
      status: 'PENDING',
      version: nextVersion,
      isCurrent: true
    });

    processSingleDocument(replacement.toObject()).catch(err =>
      console.error(`[OCR] Background processing failed for replacement ${replacement._id}:`, err.message)
    );

    await StudentDocument.updateOne(
      { _id: targetDocument._id },
      {
        $set: {
          isCurrent: false,
          supersededBy: replacement._id,
          replacedAt: new Date(),
          replacedBy: req.user.id
        }
      }
    );

    res.json({
      success: true,
      message: 'Document replaced successfully with a new version',
      document: mapStudentDocument({
        ...replacement.toObject(),
        documentTypeDisplay: requirement.name || requirement.label || getDocumentTypeDisplayName(requirement.type)
      })
    });
  } catch (error) {
    console.error('❌ Error replacing document:', error);
    if (req.file) await deleteFromS3(req.file.key || req.file.location).catch(() => {});
    res.status(500).json({
      success: false,
      message: 'Error replacing document',
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
    
    const { studentEmail, documentTypeId, documentType, documentName, description } = req.body;
    
    if (!studentEmail || (!documentTypeId && !documentType) || !documentName) {
      if (req.file) await deleteFromS3(req.file.key || req.file.location).catch(() => {});
      return res.status(400).json({
        success: false,
        message: 'Student email, document type, and name are required'
      });
    }
    
    // Find student by email
    const student = await User.findOne({ email: studentEmail, role: 'STUDENT' });
    if (!student) {
      if (req.file) await deleteFromS3(req.file.key || req.file.location).catch(() => {});
      return res.status(404).json({
        success: false,
        message: 'Student not found with this email'
      });
    }

    const requirement = await resolveDocumentRequirement({ documentTypeId, documentType });
    if (!requirement) {
      if (req.file) await deleteFromS3(req.file.key || req.file.location).catch(() => {});
      return res.status(400).json({
        success: false,
        message: 'Invalid document type. Admin upload must use predefined document types.'
      });
    }

    const latestVersion = await StudentDocument.findOne({
      studentId: student._id,
      documentTypeId: requirement._id
    }).sort({ version: -1 }).lean();
    const nextVersion = latestVersion ? Number(latestVersion.version || 1) + 1 : 1;

    if (!requirement.allowMultiple) {
      await StudentDocument.updateMany(
        { studentId: student._id, documentTypeId: requirement._id, isCurrent: true },
        { $set: { isCurrent: false, replacedAt: new Date(), replacedBy: req.user.id } }
      );
    }
    
    // Create document record — filePath is now the S3 URL
    const document = new StudentDocument({
      studentId: student._id,
      studentName: student.name,
      studentEmail: student.email,
      documentTypeId: requirement._id,
      documentType: requirement.type,
      documentName,
      documentCategory: requirement.category || 'OTHER',
      fileName: req.file.originalname,
      filePath: req.file.location,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      description: description || 'Uploaded by admin',
      status: 'PENDING',
      version: nextVersion,
      isCurrent: true
    });
    
    await document.save();

    processSingleDocument(document.toObject()).catch(err =>
      console.error(`[OCR] Background processing failed for ${document._id}:`, err.message)
    );

    let emailSent = false;
    try {
      const { sendDocumentAddedByAdminEmail, isDocumentEmailConfigured } = require('../config/documentEmailConfig');
      if (isDocumentEmailConfigured()) {
        emailSent = await sendDocumentAddedByAdminEmail({
          studentName: student.name,
          studentEmail: student.email,
          documentName: documentName || requirement.label || requirement.name
        });
      }
    } catch (mailErr) {
      console.warn('⚠️  Admin upload notification email failed:', mailErr.message);
    }
    
    console.log(`✅ Admin uploaded document: ${documentName} for ${student.name}`);
    
    res.json({
      success: true,
      message: emailSent
        ? 'Document uploaded and student notified by email'
        : 'Document uploaded successfully',
      emailSent,
      document: mapStudentDocument({
        ...document.toObject(),
        documentTypeDisplay: requirement.name || requirement.label || getDocumentTypeDisplayName(document.documentType)
      })
    });
  } catch (error) {
    console.error('❌ Error in admin upload:', error);
    
    if (req.file) await deleteFromS3(req.file.key || req.file.location).catch(() => {});
    
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
    
    const { studentEmail, documentTypeId, documentType, documentName, verificationNotes } = req.body;
    
    if (!studentEmail || (!documentTypeId && !documentType) || !documentName) {
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

    const requirement = await resolveDocumentRequirement({ documentTypeId, documentType });
    if (!requirement) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document type. Verification must use predefined document types.'
      });
    }

    const latestVersion = await StudentDocument.findOne({
      studentId: student._id,
      documentTypeId: requirement._id
    }).sort({ version: -1 }).lean();
    const nextVersion = latestVersion ? Number(latestVersion.version || 1) + 1 : 1;

    if (!requirement.allowMultiple) {
      await StudentDocument.updateMany(
        { studentId: student._id, documentTypeId: requirement._id, isCurrent: true },
        { $set: { isCurrent: false, replacedAt: new Date(), replacedBy: req.user.id } }
      );
    }
    
    // Create document record with VERIFIED status and no file
    const document = new StudentDocument({
      studentId: student._id,
      studentName: student.name,
      studentEmail: student.email,
      documentTypeId: requirement._id,
      documentType: requirement.type,
      documentName,
      documentCategory: requirement.category || 'OTHER',
      fileName: 'NO_FILE_UPLOADED',
      filePath: 'NO_FILE_UPLOADED',
      fileSize: 0,
      mimeType: 'application/octet-stream',
      description: 'Document verified without file upload - collected physically or through other means',
      status: 'VERIFIED',
      verifiedBy: req.user.id,
      verifiedAt: new Date(),
      verificationNotes: verificationNotes || 'Document verified without file upload',
      remarks: verificationNotes || 'Document verified without file upload',
      version: nextVersion,
      isCurrent: true
    });
    
    await document.save();
    
    console.log(`✅ Admin marked document as verified: ${documentName} for ${student.name}`);
    
    res.json({
      success: true,
      message: 'Document marked as verified successfully',
      document: mapStudentDocument({
        ...document.toObject(),
        formattedFileSize: 'N/A',
        documentTypeDisplay: requirement.name || requirement.label || getDocumentTypeDisplayName(document.documentType)
      })
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
    
    const currentFilter = { studentId, isCurrent: true };
    const totalDocuments = await StudentDocument.countDocuments(currentFilter);
    const verifiedDocuments = await StudentDocument.countDocuments({ ...currentFilter, status: 'VERIFIED' });
    const pendingDocuments = await StudentDocument.countDocuments({ ...currentFilter, status: 'PENDING' });
    const rejectedDocuments = await StudentDocument.countDocuments({ ...currentFilter, status: 'REJECTED' });
    
    // Get document types uploaded - use new keyword for ObjectId
    const currentDocsByType = await StudentDocument.aggregate([
      { $match: { studentId: new mongoose.Types.ObjectId(studentId), isCurrent: true } },
      { $group: { _id: '$documentTypeId', count: { $sum: 1 } } }
    ]);
    
    // Get required documents filtered by student's service
    const service = (student.servicesOpted || '').trim();
    const requiredDocs = await getRequirementsForStudentService(service, { requiredOnly: true });
    
    const uploadedRequiredDocs = currentDocsByType.filter((d) =>
      requiredDocs.some((r) => String(r._id) === String(d._id))
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
async function ensureDefaultRequirementsSeeded() {
  const existingCount = await DocumentRequirement.countDocuments({});
  if (existingCount > 0) return;

  await DocumentRequirement.insertMany(
    DEFAULT_REQUIREMENTS.map((reqType) => ({
      type: reqType.type,
      name: reqType.name,
      label: reqType.name,
      description: reqType.name,
      category: reqType.category,
      required: reqType.isRequired,
      isRequired: reqType.isRequired,
      allowMultiple: reqType.allowMultiple,
      order: reqType.order,
      active: true
    }))
  );
}

function requirementAppliesToStudentService(requirement, service = '') {
  const scopedServices = [
    ...(Array.isArray(requirement.applicableServices) ? requirement.applicableServices : []),
    ...(Array.isArray(requirement.programKeys) ? requirement.programKeys : [])
  ]
    .map((s) => String(s || '').trim())
    .filter(Boolean);

  if (scopedServices.length === 0) return true;

  const trimmedService = String(service || '').trim();
  if (!trimmedService) return false;

  const normalized = trimmedService.replace(/[\s\-]+/g, '[\\s\\-]*');
  const serviceRegex = new RegExp('^' + normalized + '$', 'i');
  return scopedServices.some((s) => serviceRegex.test(String(s).trim()));
}

async function getAllActiveRequirementsForStudent(service = '') {
  const allRequirements = await DocumentRequirement.find({ active: true })
    .sort({ order: 1, label: 1 })
    .lean();

  return allRequirements.map((req) => {
    const applies = requirementAppliesToStudentService(req, service);
    const baseRequired =
      typeof req.isRequired === 'boolean' ? req.isRequired : !!req.required;
    const isRequiredForStudent = applies && baseRequired;
    return {
      ...req,
      required: isRequiredForStudent,
      isRequired: isRequiredForStudent
    };
  });
}

function buildServiceScopedRequirementFilter(service = '', { requiredOnly = false } = {}) {
  const baseFilter = {
    active: true,
    ...(requiredOnly ? { $or: [{ required: true }, { isRequired: true }] } : {})
  };

  const trimmedService = String(service || '').trim();
  if (!trimmedService) {
    return baseFilter;
  }

  const normalized = trimmedService.replace(/[\s\-]+/g, '[\\s\\-]*');
  const serviceRegex = new RegExp('^' + normalized + '$', 'i');

  return {
    ...baseFilter,
    $and: [
      {
        $or: [
          { applicableServices: serviceRegex },
          { programKeys: serviceRegex },
          { applicableServices: { $size: 0 } },
          { programKeys: { $size: 0 } }
        ]
      }
    ]
  };
}

async function getRequirementsForStudentService(service = '', { requiredOnly = false } = {}) {
  const scopedFilter = buildServiceScopedRequirementFilter(service, { requiredOnly });
  let requirements = await DocumentRequirement.find(scopedFilter)
    .sort({ order: 1, label: 1 })
    .lean();

  // Fallback: if strict service matching returns nothing, show active defaults
  // so students can still upload required documents.
  if (requirements.length === 0) {
    const fallbackFilter = {
      active: true,
      ...(requiredOnly ? { $or: [{ required: true }, { isRequired: true }] } : {})
    };
    requirements = await DocumentRequirement.find(fallbackFilter)
      .sort({ order: 1, label: 1 })
      .lean();
  }

  return requirements;
}

function normalizeType(type = '') {
  return String(type).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

async function resolveDocumentRequirement({ documentTypeId, documentType }) {
  await ensureDefaultRequirementsSeeded();

  if (documentTypeId && mongoose.Types.ObjectId.isValid(documentTypeId)) {
    const byId = await DocumentRequirement.findById(documentTypeId).lean();
    if (byId && byId.active !== false) return byId;
  }

  const normalizedType = normalizeType(documentType);
  if (!normalizedType) return null;

  const byType = await DocumentRequirement.findOne({ type: normalizedType, active: true }).lean();
  return byType || null;
}

function mapRequirement(requirement) {
  return {
    id: requirement._id,
    type: requirement.type,
    name: requirement.name || requirement.label,
    label: requirement.label || requirement.name,
    description: requirement.description || '',
    category: requirement.category || 'OTHER',
    isRequired: typeof requirement.isRequired === 'boolean' ? requirement.isRequired : !!requirement.required,
    required: typeof requirement.required === 'boolean' ? requirement.required : !!requirement.isRequired,
    allowMultiple: !!requirement.allowMultiple
  };
}

function mapStudentDocument(doc) {
  return {
    ...doc,
    remarks: doc.remarks || doc.verificationNotes || '',
    verificationNotes: doc.verificationNotes || doc.remarks || '',
    documentTypeDisplay: doc.documentTypeDisplay || getDocumentTypeDisplayName(doc.documentType),
    formattedFileSize: formatFileSize(doc.fileSize || 0)
  };
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function extractS3Key(fileUrlOrKey = '') {
  if (!fileUrlOrKey) return '';
  if (!String(fileUrlOrKey).startsWith('http')) return String(fileUrlOrKey).replace(/^\//, '');

  try {
    const parsed = new URL(fileUrlOrKey);
    return parsed.pathname.replace(/^\//, '');
  } catch (error) {
    return '';
  }
}

function sanitizeDownloadFilename(name = 'document') {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function createSignedS3Url(fileUrlOrKey, opts = {}) {
  try {
    const bucket = process.env.S3_BUCKET;
    const key = extractS3Key(fileUrlOrKey);
    if (!bucket || !key) return null;

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: opts.responseContentDisposition,
      ResponseContentType: opts.responseContentType
    });

    return await getSignedUrl(s3Client, command, { expiresIn: 60 * 5 });
  } catch (error) {
    console.error('❌ Failed generating signed S3 URL:', error.message);
    return null;
  }
}

function getDocumentTypeDisplayName(type) {
  // For legacy types, provide display names; for new types, format the type key
  const displayNames = {
    'MISCELLANEOUS': 'Other Certificates',
    'BIRTH_CERTIFICATE': 'Birth Certificate',
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

    const {
      getDocumentTransporter,
      getDocumentFromAddress,
      getDocumentCc,
      isDocumentEmailConfigured,
    } = require('../config/documentEmailConfig');

    if (!isDocumentEmailConfigured()) {
      return res.status(503).json({
        success: false,
        message: 'Document email is not configured. Set DOCS_EMAIL_USER and DOCS_EMAIL_PASS in .env',
      });
    }

    const transporter = getDocumentTransporter();
    await transporter.sendMail({
      from: getDocumentFromAddress(),
      to,
      cc: getDocumentCc(),
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1a237e; color: white; padding: 20px; text-align: center;">
            <h2 style="margin:0;">Glück Global</h2>
          </div>
          <div style="padding: 20px; background: #f5f5f5;">
            <div style="white-space: pre-wrap; color:#1f2937;">${message}</div>
          </div>
          <div style="padding: 16px; text-align: center; color: #666; font-size: 12px; border-top: 1px solid #e5e7eb;">
            <p style="margin:0 0 4px 0;"><strong>Glück Global</strong></p>
            <p style="margin:0;">info@gluckglobal.com · www.gluckglobal.com</p>
          </div>
        </div>
      `,
    });

    res.json({ success: true, message: 'Email sent successfully' });
  } catch (error) {
    console.error('❌ Error sending document email:', error.message);
    res.status(500).json({ success: false, message: 'Failed to send email' });
  }
});

module.exports = router;
