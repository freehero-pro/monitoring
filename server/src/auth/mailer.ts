import nodemailer from 'nodemailer';
import type { Config } from '../config.js';
import type { Logger } from '../runner/scheduler.js';

export type Mailer = {
  sendMagicLink: (email: string, link: string) => Promise<void>;
};

/**
 * Если SMTP не настроен, ссылка печатается в лог. Это осознанный режим для локальной
 * разработки и для самого первого входа — без него запустить проект нельзя было бы,
 * пока не заведён почтовый ящик.
 */
export function createMailer(config: Config, logger: Logger): Mailer {
  if (!config.SMTP_HOST) {
    return {
      async sendMagicLink(email, link) {
        logger.warn(
          { email, link },
          'SMTP не настроен — ссылка для входа напечатана в лог, письмо не отправлено',
        );
      },
    };
  }

  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
  });

  return {
    async sendMagicLink(email, link) {
      await transport.sendMail({
        from: config.MAIL_FROM,
        to: email,
        subject: 'Вход в мониторинг',
        text: `Ссылка для входа (действует ${config.MAGIC_LINK_TTL_MINUTES} минут):\n${link}\n\nЕсли вы не запрашивали вход, просто проигнорируйте письмо.`,
        html: `<p>Ссылка для входа действует ${config.MAGIC_LINK_TTL_MINUTES} минут:</p>
<p><a href="${link}">Войти в мониторинг</a></p>
<p style="color:#666">Если вы не запрашивали вход, просто проигнорируйте письмо.</p>`,
      });
    },
  };
}
