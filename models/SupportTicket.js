const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema(
  {
    ticketNumber: { type: String, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true, maxlength: 100 },
    category: { type: String, required: true, trim: true },
    priority: { type: String, required: true, enum: ['low', 'medium', 'high'], default: 'medium' },
    description: { type: String, required: true, trim: true, maxlength: 1000 },
    status: { type: String, enum: ['open', 'in-progress', 'resolved', 'closed'], default: 'open' },
    replies: [
      {
        authorRole: {
          type: String,
          enum: ['ADMIN', 'TEACHER_ADMIN', 'SUB_ADMIN', 'SYSTEM'],
          default: 'ADMIN'
        },
        message: { type: String, required: true, trim: true, maxlength: 2000 },
        createdAt: { type: Date, default: Date.now }
      }
    ],
    screenshot: {
      fileName: String,
      originalName: String,
      mimeType: String,
      size: Number,
      url: String
    }
  },
  { timestamps: true }
);

supportTicketSchema.pre('save', function (next) {
  if (!this.ticketNumber) {
    const date = new Date();
    const y = String(date.getFullYear()).slice(-2);
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const rand = Math.floor(100000 + Math.random() * 900000);
    this.ticketNumber = `GG-${y}${m}${d}-${rand}`;
  }
  next();
});

module.exports = mongoose.model('SupportTicket', supportTicketSchema);

