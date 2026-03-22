// routes/documentRequirements.js
// Routes for managing document requirements (Admin only)

const express = require('express');
const router = express.Router();
const { verifyToken, checkRole } = require('../middleware/auth');
const DocumentRequirement = require('../models/DocumentRequirement');

// GET /api/document-requirements - Get all document requirements
// Optional query params: ?activeOnly=true&service=Work Visa
router.get('/', verifyToken, async (req, res) => {
  try {
    const { activeOnly, service } = req.query;
    
    const filter = activeOnly === 'true' ? { active: true } : {};
    
    // Filter by applicable service if provided
    if (service) {
      const normalized = service.trim().replace(/[\s\-]+/g, '[\\s\\-]*');
      filter.applicableServices = new RegExp('^' + normalized + '$', 'i');
    }
    
    const requirements = await DocumentRequirement.find(filter)
      .sort({ order: 1, label: 1 })
      .lean();
    
    res.json({
      success: true,
      requirements
    });
  } catch (error) {
    console.error('❌ Error fetching document requirements:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching document requirements',
      error: error.message
    });
  }
});

// POST /api/document-requirements - Create new document requirement (Admin only)
router.post('/', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { type, label, description, required, category, order } = req.body;
    
    // Validate required fields
    if (!type || !label || !description) {
      return res.status(400).json({
        success: false,
        message: 'Type, label, and description are required'
      });
    }
    
    // Check if type already exists
    const existing = await DocumentRequirement.findOne({ 
      type: type.toUpperCase().replace(/\s+/g, '_') 
    });
    
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'A document requirement with this type already exists'
      });
    }
    
    // Create new requirement
    const requirement = new DocumentRequirement({
      type: type.toUpperCase().replace(/\s+/g, '_'),
      label: label.trim(),
      description: description.trim(),
      required: required || false,
      category: category || 'OTHER',
      order: order || 0,
      createdBy: req.user.id
    });
    
    await requirement.save();
    
    console.log(`✅ Document requirement created: ${requirement.label} by admin ${req.user.id}`);
    
    res.json({
      success: true,
      message: 'Document requirement created successfully',
      requirement
    });
  } catch (error) {
    console.error('❌ Error creating document requirement:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating document requirement',
      error: error.message
    });
  }
});

// PUT /api/document-requirements/:id - Update document requirement (Admin only)
router.put('/:id', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { id } = req.params;
    const { label, description, required, category, order, active } = req.body;
    
    const requirement = await DocumentRequirement.findById(id);
    
    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: 'Document requirement not found'
      });
    }
    
    // Update fields
    if (label !== undefined) requirement.label = label.trim();
    if (description !== undefined) requirement.description = description.trim();
    if (required !== undefined) requirement.required = required;
    if (category !== undefined) requirement.category = category;
    if (order !== undefined) requirement.order = order;
    if (active !== undefined) requirement.active = active;
    requirement.updatedBy = req.user.id;
    
    await requirement.save();
    
    console.log(`✅ Document requirement updated: ${requirement.label} by admin ${req.user.id}`);
    
    res.json({
      success: true,
      message: 'Document requirement updated successfully',
      requirement
    });
  } catch (error) {
    console.error('❌ Error updating document requirement:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating document requirement',
      error: error.message
    });
  }
});

// DELETE /api/document-requirements/:id - Delete document requirement (Admin only)
router.delete('/:id', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const requirement = await DocumentRequirement.findById(id);
    
    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: 'Document requirement not found'
      });
    }
    
    // Soft delete by setting active to false
    requirement.active = false;
    requirement.updatedBy = req.user.id;
    await requirement.save();
    
    console.log(`✅ Document requirement deleted: ${requirement.label} by admin ${req.user.id}`);
    
    res.json({
      success: true,
      message: 'Document requirement deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting document requirement:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting document requirement',
      error: error.message
    });
  }
});

// POST /api/document-requirements/seed - Seed default requirements (Admin only)
router.post('/seed', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const defaultRequirements = [
      {
        type: 'CV',
        label: 'CV',
        description: 'Current curriculum vitae or resume',
        required: true,
        category: 'PROFESSIONAL',
        order: 1
      },
      {
        type: 'O_LEVEL_CERTIFICATE',
        label: 'O Level Certificate',
        description: 'Ordinary Level examination certificate',
        required: true,
        category: 'ACADEMIC',
        order: 2
      },
      {
        type: 'A_LEVEL_CERTIFICATE',
        label: 'A Level Certificate',
        description: 'Advanced Level examination certificate',
        required: true,
        category: 'ACADEMIC',
        order: 3
      },
      {
        type: 'ACADEMIC_TRANSCRIPT',
        label: 'Academic Transcript',
        description: 'Official academic transcripts from educational institutions',
        required: true,
        category: 'ACADEMIC',
        order: 4
      },
      {
        type: 'PASSPORT',
        label: 'Passport',
        description: 'Valid passport copy (photo and details page)',
        required: true,
        category: 'IDENTIFICATION',
        order: 5
      },
      {
        type: 'BROWN_CERTIFICATE',
        label: 'Brown Certificate',
        description: 'Brown certificate (if applicable)',
        required: false,
        category: 'ACADEMIC',
        order: 6
      },
      {
        type: 'DEGREE_DIPLOMA',
        label: 'Degree / Diploma',
        description: 'University degree or diploma certificate (if no degree, not required)',
        required: false,
        category: 'ACADEMIC',
        order: 7
      },
      {
        type: 'EXPERIENCE_LETTER',
        label: 'Experience Letter',
        description: 'Work experience letters from previous employers',
        required: false,
        category: 'PROFESSIONAL',
        order: 8
      },
      {
        type: 'LANGUAGE_CERTIFICATE',
        label: 'Language Certificate',
        description: 'Language proficiency certificates (IELTS, TOEFL, etc.)',
        required: false,
        category: 'ACADEMIC',
        order: 9
      },
      {
        type: 'EXTRACURRICULAR_CERTIFICATE',
        label: 'Extra-curricular Certificate',
        description: 'Certificates for extra-curricular activities, sports, or achievements',
        required: false,
        category: 'OTHER',
        order: 10
      },
      {
        type: 'AFFIDAVIT',
        label: 'Affidavit',
        description: 'Affidavit (only if name differs across documents)',
        required: false,
        category: 'LEGAL',
        order: 11
      },
      {
        type: 'POLICE_CLEARANCE',
        label: 'Police Clearance',
        description: 'Police clearance certificate (mandatory for Au Pair roles; preferred for others)',
        required: false,
        category: 'LEGAL',
        order: 12
      }
    ];
    
    let created = 0;
    let skipped = 0;
    
    for (const req of defaultRequirements) {
      const existing = await DocumentRequirement.findOne({ type: req.type });
      if (!existing) {
        await DocumentRequirement.create({
          ...req,
          createdBy: req.user.id
        });
        created++;
      } else {
        skipped++;
      }
    }
    
    console.log(`✅ Seeded ${created} document requirements, skipped ${skipped} existing`);
    
    res.json({
      success: true,
      message: `Seeded ${created} document requirements successfully`,
      created,
      skipped
    });
  } catch (error) {
    console.error('❌ Error seeding document requirements:', error);
    res.status(500).json({
      success: false,
      message: 'Error seeding document requirements',
      error: error.message
    });
  }
});

module.exports = router;
