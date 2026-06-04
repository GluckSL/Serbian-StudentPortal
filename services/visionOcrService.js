const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function log(...args) {
  console.log(`[VisionOCR]`, ...args);
}

const ALL_FIELDS = {
  fullName: 'Full name of the person this document belongs to',
  firstName: 'Given / first name (if visible separately)',
  familyName: 'Surname / family name (if visible separately)',
  dateOfBirth: 'Date of birth in DD/MM/YYYY format',
  placeOfBirth: 'Place / city / town of birth',
  placeOfResidence: 'Place / city / town of residence',
  nationality: 'Nationality / citizenship',
  gender: 'Gender (M/F or as written)',
  street: 'Street name from address',
  houseNumber: 'House / building number from address',
  otherAddressInfo: 'Other address information (apartment, district, etc.)',
  postalCode: 'Postal / ZIP code from address',
  townCity: 'Town or city from address',
  country: 'Country from address',
  email: 'Email address',
  phone: 'Telephone / mobile number',
  passportNumber: 'Passport number / ID number',
  aadhaarNumber: 'Aadhaar / unique ID number (if visible)',
  epicNumber: 'EPIC / voter ID number (if visible)',
  documentNumber: 'Any other document / reference / certificate number',
  issuingAuthority: 'Authority / office that issued the document',
  issueDate: 'Date of issue in DD/MM/YYYY format',
  expiryDate: 'Date of expiry in DD/MM/YYYY format',
  fatherName: "Full name of the person's father",
  motherName: "Full name of the person's mother",
  degreeTitle: 'Title / name of the degree or qualification',
  institution: 'University / college / school / institution name',
  graduationDate: 'Date of graduation in DD/MM/YYYY format',
  studyStartDate: 'Start date of studies in DD/MM/YYYY format',
  studyEndDate: 'End date of studies in DD/MM/YYYY format',
  courseType: 'Type of course (full-time, part-time, online, etc.)',
  thesisCompleted: 'Thesis title or yes/no if a thesis was completed',
  studentId: 'Student / enrollment / registration number',
  rollNo: 'Roll / seat / exam number',
  subjects: 'Subjects studied or examined (comma-separated)',
  grades: 'Grades / marks / scores achieved (comma-separated)',
  year: 'Academic year or year of examination',
  examBoard: 'Examining board / council name',
  certificateNo: 'Certificate / diploma serial number',
  language: 'Language name (for language certificates)',
  level: 'Language proficiency level (A1, B2, C1, etc.)',
  score: 'Test score or grade point',
  jobTitle: 'Job title / position held',
  company: 'Company / employer name',
  startDate: 'Employment start date in DD/MM/YYYY format',
  endDate: 'Employment end date in DD/MM/YYYY format',
  employeeId: 'Employee / personnel ID number',
  activity: 'Name of extracurricular / sports / cultural activity',
  organization: 'Organizing body or club name',
};

const FIELD_SETS = {
  PASSPORT: [
    'fullName', 'firstName', 'familyName', 'dateOfBirth', 'placeOfBirth',
    'nationality', 'gender', 'passportNumber', 'issueDate', 'expiryDate',
    'issuingAuthority', 'documentNumber', 'phone',
    'street', 'houseNumber', 'postalCode', 'townCity', 'country',
    'placeOfResidence', 'otherAddressInfo',
  ],
  BIRTH_CERTIFICATE: [
    'fullName', 'dateOfBirth', 'placeOfBirth', 'fatherName', 'motherName',
  ],
  BIRTHCERTIFICATE: [
    'fullName', 'dateOfBirth', 'placeOfBirth', 'fatherName', 'motherName',
  ],
  CV: [
    'fullName', 'email', 'phone',
    'street', 'houseNumber', 'postalCode', 'townCity', 'country',
    'placeOfResidence', 'otherAddressInfo',
  ],
  ACADEMIC_TRANSCRIPT: [
    'fullName', 'firstName', 'familyName', 'degreeTitle', 'institution',
    'graduationDate', 'studyStartDate', 'studyEndDate', 'courseType',
    'thesisCompleted', 'studentId', 'rollNo', 'subjects', 'grades', 'year',
  ],
  DEGREE_TRANSCRIPT: [
    'fullName', 'firstName', 'familyName', 'degreeTitle', 'institution',
    'graduationDate', 'studyStartDate', 'studyEndDate', 'courseType',
    'thesisCompleted', 'studentId', 'rollNo', 'subjects', 'grades', 'year',
  ],
  DEGREE_DIPLOMA: [
    'fullName', 'firstName', 'familyName', 'degreeTitle', 'institution',
    'graduationDate', 'studyStartDate', 'studyEndDate', 'courseType',
    'thesisCompleted', 'studentId', 'rollNo', 'subjects', 'grades', 'year',
  ],
  DEGREE: [
    'fullName', 'firstName', 'familyName', 'degreeTitle', 'institution',
    'graduationDate', 'studyStartDate', 'studyEndDate', 'courseType',
    'thesisCompleted', 'studentId', 'rollNo', 'subjects', 'grades', 'year',
  ],
  A_LEVEL_CERTIFICATE: [
    'fullName', 'firstName', 'familyName', 'institution', 'subjects', 'grades',
    'year', 'examBoard', 'certificateNo',
  ],
  O_LEVEL_CERTIFICATE: [
    'fullName', 'firstName', 'familyName', 'institution', 'subjects', 'grades',
    'year', 'examBoard', 'certificateNo',
  ],
  LANGUAGE_CERTIFICATE: [
    'fullName', 'firstName', 'familyName', 'language', 'level', 'score',
    'institution', 'certificateNo', 'issueDate',
  ],
  EXPERIENCE_LETTER: [
    'fullName', 'firstName', 'familyName', 'jobTitle', 'company',
    'startDate', 'endDate', 'employeeId',
  ],
  EXTRACURRICULAR_CERTIFICATE: [
    'fullName', 'firstName', 'familyName', 'activity', 'organization',
  ],
  MISCELLANEOUS: ['fullName'],
};

function getFieldsForDocType(documentType) {
  const type = (documentType || '').toUpperCase();
  return FIELD_SETS[type] || FIELD_SETS.MISCELLANEOUS;
}

function buildFieldDoc(fieldKeys) {
  return fieldKeys.map(k => `    "${k}": "${ALL_FIELDS[k]} (or empty string if not found)"`).join(',\n');
}

function buildFullPrompt() {
  const allKeys = Object.keys(ALL_FIELDS);
  const fieldDoc = buildFieldDoc(allKeys);
  return `You are a precise document data extraction system. Extract ALL possible structured fields from this document image, checking for EVERY field type below.

## STRICT RULES

1. Look at the image carefully. Extract ONLY what is visibly written. Do NOT infer, guess, or fill in missing information.

2. For passport documents: decode the Machine Readable Zone (MRZ) and use it to populate the relevant fields.

3. For dates: convert to DD/MM/YYYY format. Example: "15.06.1998" → "15/06/1998".

4. NON-ENGLISH DOCUMENTS: If the document text is in a language other than English, translate ALL extracted values to English. Do NOT include original language text in any field.

5. ⚠️ CRITICAL: Only include fields that are actually present in the document. Fields not found MUST be empty string "". Do NOT make up values.

6. ⚠️ CRITICAL: Return ONLY a flat JSON object with the fields below. Do NOT wrap in another object. Do NOT include any text, commentary, markdown, or extra keys.

{
${fieldDoc}
}`;
}

function buildPrompt(documentType) {
  const type = (documentType || '').toUpperCase();
  const fieldKeys = getFieldsForDocType(documentType);
  const fieldDoc = buildFieldDoc(fieldKeys);
  return `You are a precise document data extraction system. Extract ONLY the structured fields listed below from this document image.

Document type: ${type}

## STRICT RULES

1. Look at the image carefully. Extract ONLY what is visibly written. Do NOT infer, guess, or fill in missing information.

2. For passport documents: decode the Machine Readable Zone (MRZ) and use it to populate the relevant fields.

3. For dates: convert to DD/MM/YYYY format. Example: "15.06.1998" → "15/06/1998".

4. NON-ENGLISH DOCUMENTS: If the document text is in a language other than English, translate ALL extracted values to English. Do NOT include original language text in any field.

5. ⚠️ CRITICAL: Only include fields that are actually present in the document. Fields not found MUST be empty string "". Do NOT make up values.

6. ⚠️ CRITICAL: Return ONLY a flat JSON object with the fields below. Do NOT wrap in another object. Do NOT include any text, commentary, markdown, or extra keys.

{
${fieldDoc}
}`;
}

async function extractAllFieldsFromImage(imageBuffer, mimeType) {
  const base64 = imageBuffer.toString('base64');
  log(`Sending to Vision API (all fields)...`);

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildFullPrompt() },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64}`,
            },
          },
        ],
      },
    ],
    store: false,
    max_tokens: 4096,
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  const content = (response.choices?.[0]?.message?.content || '').trim();
  log(`Vision API responded (all fields)`);

  return parseStructuredResponse(content, undefined);
}

async function extractTextWithVision(imageBuffer, mimeType, documentType) {
  const base64 = imageBuffer.toString('base64');
  const docLabel = documentType || 'unknown';
  log(`Sending ${docLabel} to Vision API...`);

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(documentType) },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64}`,
            },
          },
        ],
      },
    ],
    store: false,
    max_tokens: 4096,
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  const content = (response.choices?.[0]?.message?.content || '').trim();
  log(`Vision API responded for ${docLabel}`);

  return parseStructuredResponse(content, documentType);
}

function parseStructuredResponse(content, documentType) {
  try {
    const structured = JSON.parse(content);
    if (documentType) {
      const fieldKeys = getFieldsForDocType(documentType);
      const filledFields = fieldKeys.filter(k => structured[k]).length;
      log(`Parsed: ${filledFields}/${fieldKeys.length} fields populated`);
    } else {
      const filled = Object.keys(structured).filter(k => structured[k]).length;
      log(`Parsed: ${filled} fields populated`);
    }
    return { structured };
  } catch (e) {
    log(`Failed to parse JSON response: ${e.message}, returning empty`);
    return { structured: {} };
  }
}

module.exports = { extractTextWithVision, extractAllFieldsFromImage };
