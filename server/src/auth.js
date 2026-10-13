// Sign-in, sessions, 2FA and identity providers. The code lives in ./auth/ (see docs/BACKEND_MAP.md);
// this file only re-exports the public names so every importer stays unchanged.
export { createEmailVerification, confirmEmailVerification, emailVerificationState, verifyPassword, emailInUse, createEmailChange, confirmEmailChange, createRecoveryEmailVerification, confirmRecoveryEmail, removeRecoveryEmail, passwordSignupAllowed, emailVerificationRequired } from './auth/email.js';
export { loginWithGoogle, loginWithApple, createPhoneOtp, loginWithPhone } from './auth/identity.js';
export { login, createUser, resetToRandomPassword, createPasswordReset, resetPassword, deleteOwnAccount } from './auth/password.js';
export { onSessionRevoked, listSessions, revokeSession, revokeAllSessionsForUser, signToken, refreshToken, verifyToken, bearerFrom } from './auth/sessions.js';
export { staffLogin } from './auth/staffpin.js';
export { verify2faChallenge, my2faStatus, generate2faSecret, confirm2fa, disable2fa } from './auth/twofa.js';
