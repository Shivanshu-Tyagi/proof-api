import nodemailer from 'nodemailer';

let transporter;

const getTransporter = () => {
  if (transporter !== undefined) return transporter;
  transporter = process.env.SMTP_HOST
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined
      })
    : null;
  return transporter;
};

// Without SMTP configured (local dev) the email is printed instead of sent
export const sendMail = async ({ to, subject, text }) => {
  const smtp = getTransporter();
  if (!smtp) {
    console.log(`📧 [mail not configured] To: ${to}\nSubject: ${subject}\n${text}`);
    return;
  }
  await smtp.sendMail({
    from: process.env.MAIL_FROM || 'Twogether <no-reply@localhost>',
    to,
    subject,
    text
  });
};
