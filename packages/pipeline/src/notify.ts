import { Db, getRun, type ParcelRow } from '@forge/db';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';

export interface NotifyConfig {
  from?: string;
  to?: string[];
  slackWebhook?: string;
  region?: string;
  topN?: number;
  fetchImpl?: typeof fetch;
}

let ses: SESv2Client | null = null;
function sesClient(region?: string): SESv2Client {
  if (!ses) ses = new SESv2Client({ region });
  return ses;
}

/** Build the day's digest text from the ranked run (top N). Pure/testable. */
export function buildDigest(rows: ParcelRow[], runDate: string): { subject: string; text: string } {
  const subject = `Forge Hill — top ${rows.length} opportunities (${runDate})`;
  const lines = rows.map((r, i) => {
    const flags = r.flags.map((f) => f.code).join(', ') || 'no flags';
    return `${i + 1}. [${r.score ?? '—'}] ${r.address ?? r.mls_listing_key} — ${r.city ?? ''} · profit ${money(r.profit_mid)} · ${flags}`;
  });
  return { subject, text: `${subject}\n\n${lines.join('\n')}\n` };
}

/** Send the daily digest via SES and/or Slack (best-effort; either channel optional). */
export async function sendDailyDigest(
  db: Db,
  runDate: string,
  cfg: NotifyConfig,
): Promise<{ sent: boolean; count: number; channels: string[] }> {
  const rows = (await getRun(db, runDate)).slice(0, cfg.topN ?? 10);
  if (!rows.length) return { sent: false, count: 0, channels: [] };

  const { subject, text } = buildDigest(rows, runDate);
  const channels: string[] = [];

  if (cfg.from && cfg.to?.length) {
    await sesClient(cfg.region).send(
      new SendEmailCommand({
        FromEmailAddress: cfg.from,
        Destination: { ToAddresses: cfg.to },
        Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } },
      }),
    );
    channels.push('email');
  }

  if (cfg.slackWebhook) {
    const fetchImpl = cfg.fetchImpl ?? fetch;
    await fetchImpl(cfg.slackWebhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `*${subject}*\n\`\`\`${text}\`\`\`` }),
    });
    channels.push('slack');
  }

  return { sent: channels.length > 0, count: rows.length, channels };
}

function money(v: number | null): string {
  return v == null ? '—' : `$${Math.round(v).toLocaleString('en-US')}`;
}
