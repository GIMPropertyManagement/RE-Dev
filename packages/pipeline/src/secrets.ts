import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

/** Read a plain-string or JSON secret from Secrets Manager. */
export async function getSecretString(arn: string, region?: string): Promise<string> {
  const client = new SecretsManagerClient({ region });
  const out = await client.send(new GetSecretValueCommand({ SecretId: arn }));
  if (!out.SecretString) throw new Error(`Secret ${arn} has no string value`);
  return out.SecretString;
}

/** Read a JSON secret and pull one key (e.g. { apiKey: "..." }). */
export async function getSecretJsonField(
  arn: string,
  field: string,
  region?: string,
): Promise<string> {
  const raw = await getSecretString(arn, region);
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const v = obj[field];
    if (typeof v === 'string') return v;
  } catch {
    // Not JSON — fall through and treat the whole secret as the value.
  }
  return raw;
}
