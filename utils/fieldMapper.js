function splitName(fullName) {
  if (!fullName) return { first: '', last: '' };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

function docStatusLabel(status) {
  if (!status || status === 'NOT_UPLOADED') return 'Not Uploaded';
  if (status === 'PENDING') return 'Pending';
  if (status === 'VERIFIED') return 'Verified';
  if (status === 'REJECTED') return 'Rejected';
  return status;
}

function v(val) {
  return val && String(val).trim() ? String(val).trim() : '';
}

const HEADERS = [
  'Candidate Family Name',
  'Candidate  First Name(s)',
  'Candidate  Nationality',
  'Candidate  Date of Birth',
  'Candidate  Place of Birth',
  'Candidate Place of Residence',
  'Street',
  'House Number',
  'Other Addresses Info (If Applicable)',
  'Postal Code',
  'Town/City',
  'Country',
  'Telephone/Mobile Number',
  'Email',
  'Job Title',
  'Company',
  'Column 15',
  'Father Family Name',
  'Father First Name(s)',
  'Father Nationality',
  'Date of Birth',
  'Place of Birth',
  'Place of Residence',
  'Mother  Family Name',
  'Mother  First Name(s)',
  'Mother  Nationality',
  'Date of Birth',
  'Place of Birth',
  'Place of Residence',
  'Spouse  First Name',
  'Spouse   Last Name',
  'Date f Birth',
  'Place of Birth',
  'Address',
  'Family Relationship',
  'Family Name of Contact Person',
  'First Name(s) of Contact Person',
  'Gender',
  'Date of Birth',
  'Place of Birth',
  'Nationality',
  'Street',
  'House Number',
  'Postal Code',
  'Town/City',
  'Country',
  'Telephone/Mobile Number',
  'Passport  Scanned',
  'School/Degree Leaving Certificate  Scanned',
  'O/A Level- Scanned',
  'Degree/Diploma Certificate  Scanned',
  'Experience Letter  Scanned',
  'Language Certificates  Scanned',
  'CV',
  'Title of your degree',
  'Duration of your studies - start dates with year',
  'Duration of your studies - End dates with year',
  'Date of graduation',
  'Course Type',
  'Thesis Completed - If applicable',
  'Passport Number',
  'Aadhaar Number',
  'EPIC Number',
  'Document Number',
  'Student ID',
  'Roll Number',
  'Certificate Number',
  'Employee ID',
  'Batch',
  'Level',
];

function mapToSheetRow(extracted, user, studentDocs) {
  const name = splitName(user?.name);
  const docStatusMap = {};
  for (const doc of (studentDocs || [])) {
    const key = (doc.documentType || '').toUpperCase().replace(/\s+/g, '_');
    docStatusMap[key] = doc.status || 'PENDING';
  }

  const candidate = extracted?.candidate || {};
  const father = extracted?.father || {};
  const mother = extracted?.mother || {};
  const spouse = extracted?.spouse || {};
  const contact = extracted?.contactPerson || {};
  const edu = extracted?.education || {};

  return [
    v(candidate.familyName || name.last),
    v(candidate.firstName || name.first),
    v(candidate.nationality || user?.nationality || ''),
    v(candidate.dateOfBirth || ''),
    v(candidate.placeOfBirth || ''),
    v(candidate.placeOfResidence || ''),
    v(candidate.street || ''),
    v(candidate.houseNumber || ''),
    v(candidate.otherAddressInfo || ''),
    v(candidate.postalCode || ''),
    v(candidate.townCity || ''),
    v(candidate.country || ''),
    v(candidate.telephoneMobile || user?.phoneNumber || ''),
    v(candidate.email || user?.email || ''),
    v(candidate.jobTitle || ''),
    v(candidate.company || ''),
    '',
    v(father.familyName || ''),
    v(father.firstName || ''),
    v(father.nationality || ''),
    v(father.dateOfBirth || ''),
    v(father.placeOfBirth || ''),
    v(father.placeOfResidence || ''),
    v(mother.familyName || ''),
    v(mother.firstName || ''),
    v(mother.nationality || ''),
    v(mother.dateOfBirth || ''),
    v(mother.placeOfBirth || ''),
    v(mother.placeOfResidence || ''),
    v(spouse.firstName || ''),
    v(spouse.lastName || ''),
    v(spouse.dateOfBirth || ''),
    v(spouse.placeOfBirth || ''),
    v(spouse.address || ''),
    v(contact.familyRelationship || ''),
    v(contact.familyName || ''),
    v(contact.firstName || ''),
    v(contact.gender || ''),
    v(contact.dateOfBirth || ''),
    v(contact.placeOfBirth || ''),
    v(contact.nationality || ''),
    v(contact.street || ''),
    v(contact.houseNumber || ''),
    v(contact.postalCode || ''),
    v(contact.townCity || ''),
    v(contact.country || ''),
    v(contact.telephoneMobile || ''),
    docStatusLabel(docStatusMap['PASSPORT']),
    docStatusLabel(docStatusMap['SCHOOL_LEAVING_CERTIFICATE'] || docStatusMap['BIRTH_CERTIFICATE']),
    docStatusLabel(docStatusMap['O/A_LEVEL'] || docStatusMap['A_LEVEL_CERTIFICATE'] || docStatusMap['O_LEVEL_CERTIFICATE']),
    docStatusLabel(docStatusMap['DEGREE_DIPLOMA'] || docStatusMap['DEGREE_TRANSCRIPT'] || docStatusMap['ACADEMIC_TRANSCRIPT'] || docStatusMap['DEGREE']),
    docStatusLabel(docStatusMap['EXPERIENCE_LETTER']),
    docStatusLabel(docStatusMap['LANGUAGE_CERTIFICATE'] || docStatusMap['LANGUAGE_CERTIFICATES']),
    docStatusLabel(docStatusMap['CV']),
    v(edu.degreeTitle || ''),
    v(edu.studyStartDate || ''),
    v(edu.studyEndDate || ''),
    v(edu.graduationDate || ''),
    v(edu.courseType || ''),
    v(edu.thesisCompleted || ''),
    v(candidate.passportNumber || ''),
    v(candidate.aadhaarNumber || ''),
    v(candidate.epicNumber || ''),
    v(candidate.documentNumber || ''),
    v(candidate.studentId || ''),
    v(candidate.rollNo || ''),
    v(candidate.certificateNo || ''),
    v(candidate.employeeId || ''),
    v(user?.batch || ''),
    v(user?.level || ''),
  ];
}

function getSheetHeaders() {
  return [...HEADERS];
}

module.exports = { mapToSheetRow, getSheetHeaders };
