import {
  RDSDataClient,
  ExecuteStatementCommand,
  type SqlParameter,
} from '@aws-sdk/client-rds-data';

/**
 * Thin Aurora access via the RDS Data API (HTTP) — NOT RDS Proxy.
 *
 * The Data API pairs with Aurora Serverless v2 scale-to-zero: no persistent
 * connections, no VPC/connection-pool management from Lambda. (RDS Proxy holds
 * connections open and would PREVENT auto-pause to 0 ACU — see ARCHITECTURE.md.)
 */
export interface DataApiConfig {
  resourceArn: string; // Aurora cluster ARN
  secretArn: string; // Secrets Manager ARN holding DB creds
  database: string;
  region?: string;
}

export type ParamValue = string | number | boolean | null;

export class Db {
  private readonly client: RDSDataClient;

  constructor(private readonly cfg: DataApiConfig) {
    this.client = new RDSDataClient({ region: cfg.region });
  }

  /**
   * Run a parameterized statement. Uses named params (`:name`) and asks the Data
   * API to return rows as a JSON string (formatRecordsAs JSON), which we parse —
   * far simpler than decoding the Field[][] wire format.
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    params: Record<string, ParamValue> = {},
  ): Promise<T[]> {
    const out = await this.client.send(
      new ExecuteStatementCommand({
        resourceArn: this.cfg.resourceArn,
        secretArn: this.cfg.secretArn,
        database: this.cfg.database,
        sql,
        parameters: toParams(params),
        formatRecordsAs: 'JSON',
      }),
    );
    if (!out.formattedRecords) return [];
    return JSON.parse(out.formattedRecords) as T[];
  }

  /** Run a statement expecting no rows (INSERT/UPDATE). Returns affected count. */
  async execute(sql: string, params: Record<string, ParamValue> = {}): Promise<number> {
    const out = await this.client.send(
      new ExecuteStatementCommand({
        resourceArn: this.cfg.resourceArn,
        secretArn: this.cfg.secretArn,
        database: this.cfg.database,
        sql,
        parameters: toParams(params),
      }),
    );
    return out.numberOfRecordsUpdated ?? 0;
  }
}

function toParams(params: Record<string, ParamValue>): SqlParameter[] {
  return Object.entries(params).map(([name, v]): SqlParameter => {
    if (v === null) return { name, value: { isNull: true } };
    if (typeof v === 'string') return { name, value: { stringValue: v } };
    if (typeof v === 'boolean') return { name, value: { booleanValue: v } };
    if (Number.isInteger(v)) return { name, value: { longValue: v } };
    return { name, value: { doubleValue: v } };
  });
}
