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
  nationality: 'Nationality / citizenship',
  gender: 'Gender (M/F or as written)',
  street: 'Street name from address',
  houseNumber: 'House / building number from address',
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
    'issuingAuthority', 'documentNumber',
    'street', 'houseNumber', 'postalCode', 'townCity', 'country',
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
  ],
  ACADEMIC_TRANSCRIPT: [
    'fullName', 'firstName', 'familyName', 'degreeTitle', 'institution',
    'graduationDate', 'studyStartDate', 'studyEndDate', 'courseType',
    'studentId', 'rollNo', 'subjects', 'grades', 'year',
  ],
  DEGREE_TRANSCRIPT: [
    'fullName', 'firstName', 'familyName', 'degreeTitle', 'institution',
    'graduationDate', 'studyStartDate', 'studyEndDate', 'courseType',
    'studentId', 'rollNo', 'subjects', 'grades', 'year',
  ],
  DEGREE_DIPLOMA: [
    'fullName', 'firstName', 'familyName', 'degreeTitle', 'institution',
    'graduationDate', 'studyStartDate', 'studyEndDate', 'courseType',
    'studentId', 'rollNo', 'subjects', 'grades', 'year',
  ],
  DEGREE: [
    'fullName', 'firstName', 'familyName', 'degreeTitle', 'institution',
    'graduationDate', 'studyStartDate', 'studyEndDate', 'courseType',
    'studentId', 'rollNo', 'subjects', 'grades', 'year',
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

function buildPrompt(documentType) {
  const type = (documentType || '').toUpperCase();
  const fieldKeys = getFieldsForDocType(documentType);
  const fieldDoc = buildFieldDoc(fieldKeys);
  return `You are a precise document data extraction system. Extract ALL visible information from this document image.

Document type: ${type}

## Instructions

1. Read EVERY piece of text in the image carefully, including:
   - Labeled fields (text next to or under headings like "SURNAME", "DATE OF BIRTH", "NATIONALITY", etc.)
   - The Machine Readable Zone (MRZ) at the bottom (lines with "<<" and "<" separators)
   - Any fine print, borders, or stamps containing information

2. For passport documents specifically:
   - The MRZ contains encoded data — decode it and use it to fill fields
   - First name and surname often appear under "SURNAME" and "GIVEN NAMES" labels
   - The passport number appears in both the top section and the MRZ

3. For dates, accept ANY format you see (DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, etc.) and convert to DD/MM/YYYY in the output. Example: "15.06.1998" → "15/06/1998"

4. LANGUAGE TRANSLATION — STRICT REQUIREMENT: If any text in this document is in a language other than English, you MUST translate ALL field values in "structured" to English. Names, addresses, titles, and all other fields must be in English. The "rawText" field is the ONLY exception — it must remain in the original language exactly as written. This "rawText" field is NEVER parsed or used for database storage; only the "structured" JSON fields are stored.

5. Extract ONLY the fields listed below that are present in the document. Do NOT invent or guess values for fields that do not appear. Leave missing fields as empty string.

6. For the rawText field: transcribe ALL text letter-by-letter, including MRZ lines, preserving the original characters exactly. This field is for human reference only and is NEVER parsed for data extraction.

Return ONLY valid JSON with no markdown formatting, no commentary:
{
  "rawText": "Complete verbatim transcription of ALL visible text",
  "structured": {
${fieldDoc}
  }
}`;
}

function buildTextPrompt(documentType, rawText) {
  const type = (documentType || '').toUpperCase();
  const fieldKeys = getFieldsForDocType(documentType);
  const fieldDoc = buildFieldDoc(fieldKeys);
  return `You are a precise document data extraction system. Below is the raw text extracted from a ${type} document. Parse it and extract all fields.

Document type: ${type}

Raw text from document:
---
${rawText}
---

Extract ONLY the fields listed below that appear in the text. Do NOT invent or guess missing values. Leave missing fields as empty string.
Convert all dates to DD/MM/YYYY format.
LANGUAGE TRANSLATION — STRICT REQUIREMENT: If the raw text above is in a language other than English, you MUST translate ALL field values in "structured" to English. Names, addresses, titles, and all other fields must be in English. The "rawText" field is the ONLY exception — it must remain in the original language unchanged. Only the "structured" JSON is used for database storage; "rawText" is for human reference only and is NEVER parsed.

Return ONLY valid JSON with no markdown formatting, no commentary:
{
  "rawText": "the raw text provided above, unchanged",
  "structured": {
${fieldDoc}
  }
}`;
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

  return parseResponse(content, documentType);
}

async function extractStructuredFromText(rawText, documentType) {
  const docLabel = documentType || 'unknown';
  log(`Sending ${docLabel} extracted text to GPT...`);

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: buildTextPrompt(documentType, rawText),
      },
    ],
    store: false,
    max_tokens: 4096,
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  const content = (response.choices?.[0]?.message?.content || '').trim();
  log(`GPT extraction responded for ${docLabel}`);

  return parseResponse(content, documentType);
}

function parseResponse(content, documentType) {
  try {
    const parsed = JSON.parse(content);
    const rawText = (parsed.rawText || '').trim();
    const structured = parsed.structured || {};
    const fieldKeys = getFieldsForDocType(documentType);
    const filledFields = fieldKeys.filter(k => structured[k]).length;
    log(`Parsed: ${filledFields}/${fieldKeys.length} fields populated`);
    return { rawText, structured };
  } catch (e) {
    log(`Failed to parse JSON response: ${e.message}, falling back to raw text`);
    return { rawText: content, structured: {} };
  }
}

module.exports = { extractTextWithVision, extractStructuredFromText };
