import type { Config } from '../config.js';
import type { Logger } from '../runner/scheduler.js';

export type Mailer = {
  sendMagicLink: (email: string, link: string) => Promise<void>;
};

/** Транзакционная отправка Resend. */
const RESEND_API_URL = 'https://api.resend.com/emails';
/** Провайдер не должен подвешивать запрос ссылки — обрываем по таймауту. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Письмо со ссылкой для входа.
 *
 * - `console` (разработка, первый запуск): печатает ссылку в лог и не ходит в сеть.
 * - `resend` (прод): POST в REST API Resend через нативный fetch, без SDK. Ответ не-2xx
 *   приводит к исключению, чтобы неудачная отправка не выглядела как успешная.
 *
 * Другие провайдеры (SES, Postmark) добавляются новой веткой switch.
 */
export function createMailer(config: Config, logger: Logger): Mailer {
  return {
    async sendMagicLink(email, link) {
      const { subject, html, text } = renderMagicLink(link, config.MAGIC_LINK_TTL_MINUTES);

      switch (config.EMAIL_PROVIDER) {
        case 'console':
          logger.warn(
            { email, link },
            'EMAIL_PROVIDER=console — ссылка для входа напечатана в лог, письмо не отправлено',
          );
          return;

        case 'resend':
          await sendViaResend(config, logger, { to: email, subject, html, text });
          return;
      }
    },
  };
}

async function sendViaResend(
  config: Config,
  logger: Logger,
  letter: { to: string; subject: string; html: string; text: string },
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.EMAIL_FROM,
        to: [letter.to],
        subject: letter.subject,
        html: letter.html,
        text: letter.text,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // Ни ссылка, ни ключ в лог не попадают: по ссылке входят в систему.
    logger.error({ err: error, to: letter.to }, 'Resend недоступен');
    throw new Error('Не удалось отправить письмо со ссылкой');
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error(
      { status: response.status, body: body.slice(0, 500), to: letter.to },
      'Resend отклонил письмо',
    );
    throw new Error(`Не удалось отправить письмо со ссылкой (провайдер ответил ${response.status})`);
  }
}

function renderMagicLink(
  link: string,
  ttlMinutes: number,
): { subject: string; html: string; text: string } {
  const href = escapeAttr(link);
  const html = `<!doctype html><html lang="ru"><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f6f7f9;padding:24px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="420" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px">
      <tr><td style="font-size:18px;font-weight:600;color:#111;padding-bottom:8px">Вход в мониторинг</td></tr>
      <tr><td style="font-size:14px;color:#555;padding-bottom:20px">Ссылка действует ${ttlMinutes} минут и срабатывает один раз.</td></tr>
      <tr><td style="padding:4px 0 8px"><a href="${href}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 28px;border-radius:8px">Войти</a></td></tr>
      <tr><td style="font-size:12px;color:#999;padding-top:20px">Если вы не запрашивали вход, просто проигнорируйте письмо.</td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  const text = `Ссылка для входа (действует ${ttlMinutes} минут, срабатывает один раз):
${link}

Если вы не запрашивали вход, просто проигнорируйте письмо.`;

  return { subject: 'Вход в мониторинг', html, text };
}

/**
 * Ссылка наша и уже закодирована, но попадает внутрь html-атрибута: экранирование
 * кавычки не даёт случайному символу разорвать тег.
 */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
