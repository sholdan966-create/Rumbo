// Envío de correo. Sin SMTP configurado NUNCA se informa "enviado": el registro queda como "sin_configurar".
import nodemailer from 'nodemailer';

export const mailConfigured = (): boolean => Boolean(process.env.SMTP_URL && process.env.MAIL_FROM);
export interface Mail { to: string[]; subject: string; text: string; html?: string }

/** Código preparado; no fue probado contra un servidor SMTP real (ver README, "Funciones pendientes"). */
export async function sendMail(m: Mail): Promise<{ status: 'enviado' | 'sin_configurar'; detail: string }> {
  if (!mailConfigured()) return { status: 'sin_configurar', detail: 'Correo no enviado: falta configurar SMTP_URL y MAIL_FROM en el servidor.' };
  const tx = nodemailer.createTransport(process.env.SMTP_URL!);
  const info = await tx.sendMail({ from: process.env.MAIL_FROM, to: m.to.join(', '), subject: m.subject, text: m.text, html: m.html });
  return { status: 'enviado', detail: `Aceptado por el servidor SMTP (id ${info.messageId}).` };
}
