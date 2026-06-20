import { fileURLToPath } from 'node:url';
import {
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  CfnOutput,
  aws_ec2 as ec2,
  aws_rds as rds,
  aws_lambda as lambda,
  aws_lambda_nodejs as lambdaNode,
  aws_events as events,
  aws_events_targets as targets,
  aws_secretsmanager as secrets,
  aws_s3 as s3,
  aws_apigatewayv2 as apigw,
  aws_apigatewayv2_authorizers as apigwAuth,
  aws_apigatewayv2_integrations as apigwInt,
  aws_iam as iam,
  aws_cloudwatch as cw,
  aws_cloudwatch_actions as cwActions,
  aws_sns as sns,
  aws_sns_subscriptions as snsSubs,
  aws_budgets as budgets,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export interface ForgeStackProps extends StackProps {
  /** Cognito user pool created by Amplify (the auth seam). */
  userPoolId: string;
  userPoolClientId: string;
  /** Ops email for cost/error alarms (SNS + AWS Budgets). */
  alarmEmail?: string;
  /** Monthly cost budget in USD; emits an alarm at 80% / 100% actual spend. */
  monthlyBudgetUsd?: number;
  /** Daily digest delivery (notify step). */
  sesFrom?: string;
  sesTo?: string; // comma-separated
  slackWebhook?: string;
}

/**
 * The custom backend. Amplify owns hosting + Cognito; this stack owns data +
 * compute. Key decisions encoded here (see ARCHITECTURE.md):
 *   - Aurora Serverless v2 PostgreSQL + PostGIS, min ACU 0 (scale-to-zero).
 *   - Access via the RDS DATA API, never RDS Proxy (Proxy blocks auto-pause).
 *   - Lambdas run OUTSIDE the VPC: they reach Repliers/MassGIS over the internet
 *     and Aurora via the Data API (HTTPS), so there is NO NAT Gateway. The VPC
 *     exists only to host the (isolated, private) Aurora cluster.
 *   - Step Functions is intentionally omitted in v1 — a single scheduled ingest
 *     Lambda covers the once-daily bounded batch. Add it later behind the same
 *     handler interface if per-parcel enrich grows long/expensive.
 */
export class ForgeStack extends Stack {
  constructor(scope: Construct, id: string, props: ForgeStackProps) {
    super(scope, id, props);

    // VPC with NO NAT gateways — only Aurora lives in it (isolated subnets).
    const vpc = new ec2.Vpc(this, 'ForgeVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // Aurora Serverless v2 PostgreSQL (PostGIS enabled in-DB via migration).
    const cluster = new rds.DatabaseCluster(this, 'ForgeDb', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        // >= 16.3 required for scale-to-zero. PostGIS is available as an extension.
        version: rds.AuroraPostgresEngineVersion.VER_16_6,
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      writer: rds.ClusterInstance.serverlessV2('writer'),
      serverlessV2MinCapacity: 0, // scale to zero between runs
      serverlessV2MaxCapacity: 4,
      enableDataApi: true, // HTTP access; pairs with scale-to-zero (no RDS Proxy)
      defaultDatabaseName: 'forge',
      credentials: rds.Credentials.fromGeneratedSecret('forge_admin'),
      removalPolicy: RemovalPolicy.SNAPSHOT,
    });

    // Repliers API key (populate the value after deploy / out of band).
    const repliersSecret = new secrets.Secret(this, 'RepliersApiKey', {
      description: 'Repliers REPLIERS-API-KEY (JSON: { "apiKey": "..." })',
    });

    // Anthropic API key for the zoning research kind (JSON: { "apiKey": "..." }).
    const claudeSecret = new secrets.Secret(this, 'ClaudeApiKey', {
      description: 'Anthropic CLAUDE_API_KEY (JSON: { "apiKey": "..." })',
    });

    // S3: raw provider payloads, generated PDF memos, cached photos.
    const bucket = new s3.Bucket(this, 'ForgeStorage', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const dbEnv = {
      CLUSTER_ARN: cluster.clusterArn,
      DB_SECRET_ARN: cluster.secret!.secretArn,
      DB_NAME: 'forge',
    };

    // NOTE(deploy): NodejsFunction bundles each handler with esbuild. Our TS
    // sources use NodeNext ".js" import specifiers; add a tiny esbuild alias or a
    // `tsc` prebuild step so esbuild resolves them. Tracked in ARCHITECTURE.md.
    const bundling: lambdaNode.BundlingOptions = {
      format: lambdaNode.OutputFormat.ESM,
      target: 'node20',
      mainFields: ['module', 'main'],
    };

    // Ingest Lambda (scheduled). Outside the VPC -> no NAT.
    const ingestFn = new lambdaNode.NodejsFunction(this, 'IngestFn', {
      entry: resolvePkg('../../pipeline/src/handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.minutes(15),
      memorySize: 1024,
      environment: { ...dbEnv, REPLIERS_SECRET_ARN: repliersSecret.secretArn },
      bundling,
    });
    cluster.grantDataApiAccess(ingestFn);
    cluster.secret!.grantRead(ingestFn);
    repliersSecret.grantRead(ingestFn);
    bucket.grantReadWrite(ingestFn);

    // Daily cron (early-AM ET ~= 07:00 UTC). EventBridge -> ingest Lambda.
    new events.Rule(this, 'DailyIngest', {
      schedule: events.Schedule.cron({ minute: '0', hour: '7' }),
      targets: [new targets.LambdaFunction(ingestFn)],
    });

    // Enrich Lambda (research -> feasibility -> score -> rank). Outside VPC -> no NAT.
    const enrichFn = new lambdaNode.NodejsFunction(this, 'EnrichFn', {
      entry: resolvePkg('../../pipeline/src/enrichHandler.ts'),
      handler: 'enrichHandler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.minutes(15),
      memorySize: 1024,
      environment: {
        ...dbEnv,
        REPLIERS_SECRET_ARN: repliersSecret.secretArn,
        CLAUDE_SECRET_ARN: claudeSecret.secretArn,
        SES_FROM: props.sesFrom ?? '',
        SES_TO: props.sesTo ?? '',
        SLACK_WEBHOOK: props.slackWebhook ?? '',
      },
      bundling,
    });
    cluster.grantDataApiAccess(enrichFn);
    cluster.secret!.grantRead(enrichFn);
    repliersSecret.grantRead(enrichFn);
    claudeSecret.grantRead(enrichFn);
    bucket.grantReadWrite(enrichFn);
    // SES send for the daily digest.
    enrichFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['ses:SendEmail'], resources: ['*'] }),
    );

    // Enrich runs 30 min after ingest.
    new events.Rule(this, 'DailyEnrich', {
      schedule: events.Schedule.cron({ minute: '30', hour: '7' }),
      targets: [new targets.LambdaFunction(enrichFn)],
    });

    // App API Lambda (synchronous). Outside the VPC -> no NAT.
    const apiFn = new lambdaNode.NodejsFunction(this, 'ApiFn', {
      entry: resolvePkg('../../api/src/handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      memorySize: 1024, // pdf-lib memo generation
      environment: { ...dbEnv, BUCKET: bucket.bucketName },
      bundling,
    });
    cluster.grantDataApiAccess(apiFn);
    cluster.secret!.grantRead(apiFn);
    bucket.grantReadWrite(apiFn);

    // HTTP API locked behind the Amplify Cognito user pool (JWT authorizer).
    const issuer = `https://cognito-idp.${this.region}.amazonaws.com/${props.userPoolId}`;
    const authorizer = new apigwAuth.HttpJwtAuthorizer('CognitoAuth', issuer, {
      jwtAudience: [props.userPoolClientId],
    });
    const httpApi = new apigw.HttpApi(this, 'ForgeApi', {
      defaultAuthorizer: authorizer,
    });
    const integration = new apigwInt.HttpLambdaIntegration('ApiInt', apiFn);
    httpApi.addRoutes({ path: '/parcels', methods: [apigw.HttpMethod.GET], integration });
    httpApi.addRoutes({ path: '/parcels/{id}', methods: [apigw.HttpMethod.GET], integration });
    httpApi.addRoutes({ path: '/parcels/{id}/proforma', methods: [apigw.HttpMethod.POST], integration });
    httpApi.addRoutes({ path: '/parcels/{id}/watch', methods: [apigw.HttpMethod.POST], integration });
    httpApi.addRoutes({ path: '/parcels/{id}/reresearch', methods: [apigw.HttpMethod.POST], integration });
    httpApi.addRoutes({ path: '/runs/{date}', methods: [apigw.HttpMethod.GET], integration });
    httpApi.addRoutes({ path: '/digest/today', methods: [apigw.HttpMethod.GET], integration });
    httpApi.addRoutes({ path: '/parcels/{id}/report.pdf', methods: [apigw.HttpMethod.GET], integration });

    // --- Ops: alarms + monthly cost budget ----------------------------------
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', { displayName: 'Forge Hill alarms' });
    if (props.alarmEmail) {
      alarmTopic.addSubscription(new snsSubs.EmailSubscription(props.alarmEmail));
    }
    // Error alarm on each Lambda — any error in a 15-min window pages ops.
    for (const [name, fn] of [
      ['Ingest', ingestFn],
      ['Enrich', enrichFn],
      ['Api', apiFn],
    ] as const) {
      fn.metricErrors({ period: Duration.minutes(15) })
        .createAlarm(this, `${name}ErrorsAlarm`, {
          threshold: 1,
          evaluationPeriods: 1,
          comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
          treatMissingData: cw.TreatMissingData.NOT_BREACHING,
        })
        .addAlarmAction(new cwActions.SnsAction(alarmTopic));
    }
    // Monthly cost budget (covers AWS + the per-run Claude/Repliers spend shows
    // up via usage; this is the AWS-side guardrail). Alerts at 80% and 100%.
    if (props.monthlyBudgetUsd && props.alarmEmail) {
      new budgets.CfnBudget(this, 'MonthlyBudget', {
        budget: {
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount: props.monthlyBudgetUsd, unit: 'USD' },
        },
        notificationsWithSubscribers: [80, 100].map((threshold) => ({
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'EMAIL', address: props.alarmEmail! }],
        })),
      });
    }

    new CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint });
    new CfnOutput(this, 'ClusterArn', { value: cluster.clusterArn });
    new CfnOutput(this, 'DbSecretArn', { value: cluster.secret!.secretArn });
    new CfnOutput(this, 'RepliersSecretArn', { value: repliersSecret.secretArn });
    new CfnOutput(this, 'StorageBucket', { value: bucket.bucketName });
  }
}

function resolvePkg(rel: string): string {
  return fileURLToPath(new URL(rel, import.meta.url));
}
