const mongoose = require('mongoose');

const documentUsedSchema = new mongoose.Schema({
  documentTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentRequirement' },
  documentType:   { type: String },
  fileName:       { type: String },
  filePath:       { type: String },
  documentName:   { type: String },
}, { _id: false });

const personSchema = new mongoose.Schema({
  familyName:        { type: String, default: '' },
  firstName:         { type: String, default: '' },
  nationality:       { type: String, default: '' },
  dateOfBirth:       { type: String, default: '' },
  placeOfBirth:      { type: String, default: '' },
  placeOfResidence:  { type: String, default: '' },
}, { _id: false });

const personDetailSchema = new mongoose.Schema({
  familyName:        { type: String, default: '' },
  firstName:         { type: String, default: '' },
  gender:            { type: String, default: '' },
  nationality:       { type: String, default: '' },
  dateOfBirth:       { type: String, default: '' },
  placeOfBirth:      { type: String, default: '' },
  street:            { type: String, default: '' },
  houseNumber:       { type: String, default: '' },
  postalCode:        { type: String, default: '' },
  townCity:          { type: String, default: '' },
  country:           { type: String, default: '' },
  telephoneMobile:   { type: String, default: '' },
}, { _id: false });

const candidateSchema = new mongoose.Schema({
  familyName:       { type: String, default: '' },
  firstName:        { type: String, default: '' },
  gender:           { type: String, default: '' },
  nationality:      { type: String, default: '' },
  dateOfBirth:      { type: String, default: '' },
  placeOfBirth:     { type: String, default: '' },
  placeOfResidence: { type: String, default: '' },
  street:           { type: String, default: '' },
  houseNumber:      { type: String, default: '' },
  otherAddressInfo: { type: String, default: '' },
  postalCode:       { type: String, default: '' },
  townCity:         { type: String, default: '' },
  country:          { type: String, default: '' },
  telephoneMobile:  { type: String, default: '' },
  email:            { type: String, default: '' },
  documentNumbers:  { type: String, default: '' },
}, { _id: false });

const spouseSchema = new mongoose.Schema({
  firstName:   { type: String, default: '' },
  lastName:    { type: String, default: '' },
  dateOfBirth: { type: String, default: '' },
  placeOfBirth:{ type: String, default: '' },
  address:     { type: String, default: '' },
}, { _id: false });

const contactPersonSchema = new mongoose.Schema({
  familyRelationship: { type: String, default: '' },
  familyName:         { type: String, default: '' },
  firstName:          { type: String, default: '' },
  gender:             { type: String, default: '' },
  dateOfBirth:        { type: String, default: '' },
  placeOfBirth:       { type: String, default: '' },
  nationality:        { type: String, default: '' },
  street:             { type: String, default: '' },
  houseNumber:        { type: String, default: '' },
  postalCode:         { type: String, default: '' },
  townCity:           { type: String, default: '' },
  country:            { type: String, default: '' },
  telephoneMobile:    { type: String, default: '' },
}, { _id: false });

const documentStatusSchema = new mongoose.Schema({
  passport:                { type: String, default: 'NOT_UPLOADED' },
  schoolLeavingCertificate:{ type: String, default: 'NOT_UPLOADED' },
  oALevel:                 { type: String, default: 'NOT_UPLOADED' },
  degreeDiploma:           { type: String, default: 'NOT_UPLOADED' },
  experienceLetter:        { type: String, default: 'NOT_UPLOADED' },
  languageCertificates:    { type: String, default: 'NOT_UPLOADED' },
  cv:                      { type: String, default: 'NOT_UPLOADED' },
}, { _id: false });

const educationSchema = new mongoose.Schema({
  degreeTitle:     { type: String, default: '' },
  institution:     { type: String, default: '' },
  studyStartDate:  { type: String, default: '' },
  studyEndDate:    { type: String, default: '' },
  graduationDate:  { type: String, default: '' },
  courseType:      { type: String, default: '' },
  thesisCompleted: { type: String, default: '' },
  subjects:        { type: String, default: '' },
  grades:          { type: String, default: '' },
  year:            { type: String, default: '' },
}, { _id: false });

const studentExtractedDataSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  },
  regNo: { type: String, required: true },
  documentsUsed: [documentUsedSchema],
  ocrStatus: {
    type: String,
    enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
    default: 'PENDING',
  },
  ocrProcessedAt: { type: Date },
  lastSyncedToSheet: { type: Date },
  candidate: { type: candidateSchema, default: () => ({}) },
  father:    { type: personSchema, default: () => ({}) },
  mother:    { type: personSchema, default: () => ({}) },
  spouse:    { type: spouseSchema, default: () => ({}) },
  contactPerson: { type: contactPersonSchema, default: () => ({}) },
  documentStatus: { type: documentStatusSchema, default: () => ({}) },
  education: { type: educationSchema, default: () => ({}) },
}, {
  timestamps: true,
});

module.exports = mongoose.model('StudentExtractedData', studentExtractedDataSchema);
