import nodemailer from "nodemailer";

export async function sendResetMail(email: string, token: string) {
    const transporter = nodemailer.createTransport({ sendmail: true });
    await transporter.sendMail({
        from: "no-reply@toolfb.com",
        to: email,
        subject: "Reset password",
        text: `Reset link: http://localhost:3000/reset?token=${token}`,
    });
}