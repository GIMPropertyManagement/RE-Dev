import { defineAuth } from '@aws-amplify/backend';

/**
 * Cognito auth for the Forge Hill Land Analyzer — 3 trusted internal users.
 *
 * - Email + password login.
 * - No public self-registration: the admin creates the 3 users (enforced in
 *   backend.ts via adminCreateUserConfig.allowAdminCreateUserOnly).
 * - MFA OPTIONAL (TOTP). It is *available* at enrollment; given the long-lived
 *   session (see backend.ts), recommend each user turns it on. Switch `mode` to
 *   'REQUIRED' to mandate it.
 * - `admins` group gates privileged actions (e.g. the "revoke all sessions"
 *   Global Sign-Out path).
 *
 * @see https://docs.amplify.aws/react/build-a-backend/auth
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  multifactor: {
    mode: 'OPTIONAL',
    totp: true,
  },
  groups: ['admins'],
  accountRecovery: 'EMAIL_ONLY',
});
