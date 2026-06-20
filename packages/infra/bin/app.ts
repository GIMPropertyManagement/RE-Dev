import { App } from 'aws-cdk-lib';
import { ForgeStack } from '../lib/forge-stack.js';

/**
 * Entry point. The Cognito user pool is created by Amplify (frontend stack);
 * pass its ids in so the API's JWT authorizer trusts it. Wire these from your
 * Amplify outputs (amplify_outputs.json) via env or CDK context.
 */
const app = new App();

const userPoolId =
  process.env.USER_POOL_ID ?? app.node.tryGetContext('userPoolId') ?? '';
const userPoolClientId =
  process.env.USER_POOL_CLIENT_ID ?? app.node.tryGetContext('userPoolClientId') ?? '';

new ForgeStack(app, 'ForgeHillStack', {
  userPoolId,
  userPoolClientId,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
});
