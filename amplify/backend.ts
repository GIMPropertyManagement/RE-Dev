import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';

/**
 * Amplify Gen 2 backend — used ONLY for Cognito auth (and, via Amplify Hosting,
 * the React SPA + CI/CD). The application data layer is NOT here: it lives in a
 * separate CDK app (packages/infra) on Aurora Serverless v2 + PostGIS, because
 * the analyzer needs spatial parcel resolution and relational queries that
 * DynamoDB/AppSync don't fit. The starter `data` (Todo) model was removed — it
 * shipped a public-API-key CRUD endpoint that has no place here.
 */
const backend = defineBackend({
  auth,
});

const { cfnUserPool, cfnUserPoolClient } = backend.auth.resources.cfnResources;

// No public sign-up — admin creates the 3 users only.
cfnUserPool.adminCreateUserConfig = {
  allowAdminCreateUserOnly: true,
};

// Remember devices so the long-lived refresh-token session survives across
// restarts without re-prompting (and lets a confirmed device skip MFA).
cfnUserPool.deviceConfiguration = {
  challengeRequiredOnNewDevice: true,
  deviceOnlyRememberedOnUserPrompt: false,
};

// --- Session lifetime -------------------------------------------------------
// Product decision: ~10-year "stay logged in". Refresh token validity is set to
// the Cognito max (3650 days). Access/ID tokens stay short (60 min) and the
// Amplify SDK silently refreshes them, so the user effectively never re-logs in.
//
// SECURITY RAILS (mandatory because the refresh token never expires on its own):
//   - enableTokenRevocation: the admin "revoke all sessions" path (Cognito
//     Global Sign-Out) is the ONLY way to end a stolen long session — it must
//     be on.
//   - The token lives in the SPA's storage (localStorage); an httpOnly cookie is
//     NOT achievable in a client-side Vite app. Pair this with a strict CSP and
//     MFA (see auth/resource.ts) to bound XSS blast radius. See ARCHITECTURE.md.
cfnUserPoolClient.refreshTokenValidity = 3650; // days
cfnUserPoolClient.accessTokenValidity = 60; // minutes
cfnUserPoolClient.idTokenValidity = 60; // minutes
cfnUserPoolClient.tokenValidityUnits = {
  refreshToken: 'days',
  accessToken: 'minutes',
  idToken: 'minutes',
};
cfnUserPoolClient.enableTokenRevocation = true;
