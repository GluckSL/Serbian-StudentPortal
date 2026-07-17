// config/emailConfig.js
const nodemailer = require('nodemailer');
const { wrapTransporter } = require('./emailKillSwitch');

const transporter = wrapTransporter(
  nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT) || 587,
    secure: process.env.EMAIL_SECURE === 'true', // true for 465, false for 587
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  })
);

module.exports = transporter;
