const DASH = '-';

function splitName(fullName) {
  if (!fullName) return { first: DASH, last: DASH };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: DASH };
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
  return val && val.trim() ? val.trim() : DASH;
}

function mapToSheetRow(extracted, user, studentDocs) {
  const name = splitName(user?.name);
  const docStatusMap = {};
  for (const doc of (studentDocs || [])) {
    const key = (doc.documentType || '').toUpperCase().replace(/\s+/g, '_');
    docStatusMap[key] = doc.status || 'PENDING';
  }

  const ds = extracted?.documentStatus || {};
  const candidate = extracted?.candidate || {};
  const father = extracted?.father || {};
  const mother = extracted?.mother || {};
  const spouse = extracted?.spouse || {};
  const contact = extracted?.contactPerson || {};
  const edu = extracted?.education || {};

  return {
    'Candidate Family Name': v(candidate.familyName || name.last),
    'Candidate First Name(s)': v(candidate.firstName || name.first),
    'Candidate Nationality': v(candidate.nationality || user?.nationality || ''),
    'Candidate Date of Birth': v(candidate.dateOfBirth || ''),
    'Candidate Place of Birth': v(candidate.placeOfBirth || ''),
    'Candidate Place of Residence': v(candidate.placeOfResidence || ''),
    'Street': v(candidate.street || ''),
    'House Number': v(candidate.houseNumber || ''),
    'Other Addresses Info (If Applicable)': v(candidate.otherAddressInfo || ''),
    'Postal Code': v(candidate.postalCode || ''),
    'Town/City': v(candidate.townCity || ''),
    'Country': v(candidate.country || ''),
    'Telephone/Mobile Number': v(candidate.telephoneMobile || user?.phoneNumber || ''),
    'Email': v(candidate.email || user?.email || ''),
    'Column 15': DASH,
    'Father Family Name': v(father.familyName || ''),
    'Father First Name(s)': v(father.firstName || ''),
    'Father Nationality': v(father.nationality || ''),
    'Date of Birth': v(father.dateOfBirth || ''),
    'Place of Birth': v(father.placeOfBirth || ''),
    'Place of Residence': v(father.placeOfResidence || ''),
    'Mother Family Name': v(mother.familyName || ''),
    'Mother First Name(s)': v(mother.firstName || ''),
    'Mother Nationality': v(mother.nationality || ''),
    'Date of Birth': v(mother.dateOfBirth || ''),
    'Place of Birth': v(mother.placeOfBirth || ''),
    'Place of Residence': v(mother.placeOfResidence || ''),
    'Spouse First Name': v(spouse.firstName || ''),
    'Spouse Last Name': v(spouse.lastName || ''),
    'Date f Birth': v(spouse.dateOfBirth || ''),
    'Place of Birth': v(spouse.placeOfBirth || ''),
    'Address': v(spouse.address || ''),
    'Family Relationship': v(contact.familyRelationship || ''),
    'Family Name of Contact Person': v(contact.familyName || ''),
    'First Name(s) of Contact Person': v(contact.firstName || ''),
    'Gender': v(contact.gender || ''),
    'Date of Birth': v(contact.dateOfBirth || ''),
    'Place of Birth': v(contact.placeOfBirth || ''),
    'Nationality': v(contact.nationality || ''),
    'Street': v(contact.street || ''),
    'House Number': v(contact.houseNumber || ''),
    'Postal Code': v(contact.postalCode || ''),
    'Town/City': v(contact.townCity || ''),
    'Country': v(contact.country || ''),
    'Telephone/Mobile Number': v(contact.telephoneMobile || ''),
    'Passport Status': docStatusLabel(docStatusMap['PASSPORT'] || ds.passport),
    'School/Degree Certificate Status': docStatusLabel(docStatusMap['SCHOOL_LEAVING_CERTIFICATE'] || ds.schoolLeavingCertificate),
    'O/A Level Status': docStatusLabel(docStatusMap['O/A_LEVEL'] || docStatusMap['A/L_CERTIFICATE'] || ds.oALevel),
    'Degree/Diploma Status': docStatusLabel(docStatusMap['DEGREE_DIPLOMA'] || docStatusMap['DEGREE_TRANSCRIPT'] || ds.degreeDiploma),
    'Experience Letter Status': docStatusLabel(docStatusMap['EXPERIENCE_LETTER'] || ds.experienceLetter),
    'Language Certificate Status': docStatusLabel(docStatusMap['LANGUAGE_CERTIFICATE'] || docStatusMap['LANGUAGE_CERTIFICATES'] || ds.languageCertificates),
    'CV Status': docStatusLabel(docStatusMap['CV'] || ds.cv),
    'Title of your degree': v(edu.degreeTitle || ''),
    'Duration of your studies - start dates with year': v(edu.studyStartDate || ''),
    'Duration of your studies - End dates with year': v(edu.studyEndDate || ''),
    'Date of graduation': v(edu.graduationDate || ''),
    'Course Type': v(edu.courseType || ''),
    'Thesis Completed - If applicable': v(edu.thesisCompleted || ''),
  };
}

function getSheetHeaders() {
  return Object.keys(mapToSheetRow({}, {}, []));
}

module.exports = { mapToSheetRow, getSheetHeaders };
