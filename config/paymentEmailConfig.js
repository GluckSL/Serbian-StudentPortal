// config/paymentEmailConfig.js
const nodemailer = require('nodemailer');
const { wrapTransporter } = require('./emailKillSwitch');

const paymentTransporter = wrapTransporter(
  nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.PAYMENT_EMAIL_USER,
      pass: process.env.PAYMENT_EMAIL_PASS,
    },
  })
);

module.exports = paymentTransporter;
