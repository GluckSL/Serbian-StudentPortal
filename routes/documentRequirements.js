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
    const { activeOnly, service, requiredOnly } = req.query;
    
    const filter = activeOnly === 'true' ? { active: true } : {};
    
    if (requiredOnly === 'true') {
      filter.$or = [{ isRequired: true }, { required: true }];
    }

    // Filter by applicable service/program if provided
    if (service) {
      const normalized = service.trim().replace(/[\s\-]+/g, '[\\s\\-]*');
      const serviceRegex = new RegExp('^' + normalized + '$', 'i');
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          { applicableServices: serviceRegex },
          { programKeys: serviceRegex },
          { applicableServices: { $size: 0 } },
          { programKeys: { $size: 0 } }
        ]
      });
    }
    
    const requirements = await DocumentRequirement.find(filter)
      .sort({ order: 1, label: 1 })
      .lean();
    
    const mapped = requirements.map((r) => ({
      ...r,
      id: r._id,
      name: r.name || r.label,
      label: r.label || r.name,
      isRequired: typeof r.isRequired === 'boolean' ? r.isRequired : !!r.required,
      required: typeof r.required === 'boolean' ? r.required : !!r.isRequired,
      allowMultiple: !!r.allowMultiple,
      programKeys: Array.isArray(r.programKeys) && r.programKeys.length > 0 ? r.programKeys : (r.applicableServices || [])
    }));

    res.json({
      success: true,
      requirements: mapped
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
    const {
      type,
      label,
      name,
      description,
      required,
      isRequired,
      allowMultiple,
      category,
      order,
      applicableServices,
      programKeys
    } = req.body;
    
    // Validate required fields
    if ((!type && !label && !name) || !description) {
      return res.status(400).json({
        success: false,
        message: 'Name/label/type and description are required'
      });
    }

    const canonicalName = (name || label || type || '').trim();
    const canonicalType = (type || canonicalName).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    
    // Check if type already exists
    const existing = await DocumentRequirement.findOne({ 
      type: canonicalType
    });
    
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'A document requirement with this type already exists'
      });
    }
    
    // Create new requirement
    const requirement = new DocumentRequirement({
      type: canonicalType,
      name: canonicalName,
      label: canonicalName,
      description: description.trim(),
      required: typeof required === 'boolean' ? required : !!isRequired,
      isRequired: typeof isRequired === 'boolean' ? isRequired : !!required,
      allowMultiple: !!allowMultiple,
      category: category || 'OTHER',
      order: order || 0,
      applicableServices: Array.isArray(applicableServices) ? applicableServices : [],
      programKeys: Array.isArray(programKeys) ? programKeys : (Array.isArray(applicableServices) ? applicableServices : []),
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
    const {
      label,
      name,
      description,
      required,
      isRequired,
      allowMultiple,
      category,
      order,
      active,
      applicableServices,
      programKeys
    } = req.body;
    
    const requirement = await DocumentRequirement.findById(id);
    
    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: 'Document requirement not found'
      });
    }
    
    // Update fields
    if (label !== undefined) requirement.label = label.trim();
    if (name !== undefined) requirement.name = name.trim();
    if (description !== undefined) requirement.description = description.trim();
    if (required !== undefined) requirement.required = required;
    if (isRequired !== undefined) requirement.isRequired = isRequired;
    if (allowMultiple !== undefined) requirement.allowMultiple = allowMultiple;
    if (category !== undefined) requirement.category = category;
    if (order !== undefined) requirement.order = order;
    if (active !== undefined) requirement.active = active;
    if (applicableServices !== undefined) requirement.applicableServices = Array.isArray(applicableServices) ? applicableServices : [];
    if (programKeys !== undefined) requirement.programKeys = Array.isArray(programKeys) ? programKeys : [];
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
        type: 'MISCELLANEOUS',
        name: 'Other Certificates',
        label: 'Other Certificates',
        description: 'Any additional certificates relevant for evaluation',
        required: true,
        isRequired: true,
        allowMultiple: false,
        category: 'OTHER',
        order: 1
      },
      {
        type: 'BIRTH_CERTIFICATE',
        name: 'Birth Certificate',
        label: 'Birth Certificate',
        description: 'Official birth certificate',
        required: true,
        isRequired: true,
        allowMultiple: false,
        category: 'IDENTIFICATION',
        order: 2
      },
      {
        type: 'EXTRACURRICULAR_CERTIFICATE',
        name: 'Extra-curricular Certificate',
        label: 'Extra-curricular Certificate',
        description: 'Upload one or more: Diploma in English, Diploma in Sinhala, Diploma in IT',
        required: true,
        isRequired: true,
        allowMultiple: true,
        category: 'ACADEMIC',
        order: 3
      },
      {
        type: 'EXPERIENCE_LETTER',
        name: 'Work Related Certificate',
        label: 'Work Related Certificate',
        description: 'Experience letters or related work certificates',
        required: true,
        isRequired: true,
        allowMultiple: false,
        category: 'PROFESSIONAL',
        order: 4
      },
      {
        type: 'LANGUAGE_CERTIFICATE',
        name: 'Language Certificate',
        label: 'Language Certificate',
        description: 'Language proficiency certificate',
        required: true,
        isRequired: true,
        allowMultiple: false,
        category: 'ACADEMIC',
        order: 5
      },
      {
        type: 'PASSPORT',
        name: 'Passport Copy',
        label: 'Passport Copy',
        description: 'Valid passport copy',
        required: true,
        isRequired: true,
        allowMultiple: false,
        category: 'IDENTIFICATION',
        order: 6
      },
      {
        type: 'ACADEMIC_TRANSCRIPT',
        name: 'Degree Transcript',
        label: 'Degree Transcript',
        description: 'Academic transcript / degree transcript',
        required: true,
        isRequired: true,
        allowMultiple: false,
        category: 'ACADEMIC',
        order: 7
      },
      {
        type: 'A_LEVEL_CERTIFICATE',
        name: 'A/L Certificate',
        label: 'A/L Certificate',
        description: 'Advanced level certificate',
        required: true,
        isRequired: true,
        allowMultiple: false,
        category: 'ACADEMIC',
        order: 8
      },
      {
        type: 'CV',
        name: 'CV',
        label: 'CV',
        description: 'Curriculum vitae',
        required: true,
        isRequired: true,
        allowMultiple: false,
        category: 'PROFESSIONAL',
        order: 9
      }
    ];
    
    let created = 0;
    let skipped = 0;
    
    for (const requirementSeed of defaultRequirements) {
      const existing = await DocumentRequirement.findOne({ type: requirementSeed.type });
      if (!existing) {
        await DocumentRequirement.create({
          ...requirementSeed,
          createdBy: req.user.id
        });
        created++;
      } else {
        existing.name = requirementSeed.name;
        existing.label = requirementSeed.label;
        existing.description = requirementSeed.description;
        existing.required = requirementSeed.required;
        existing.isRequired = requirementSeed.isRequired;
        existing.allowMultiple = requirementSeed.allowMultiple;
        existing.category = requirementSeed.category;
        existing.order = requirementSeed.order;
        existing.active = true;
        existing.updatedBy = req.user.id;
        await existing.save();
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
