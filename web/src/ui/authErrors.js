/**
 * What went wrong with an account request, in the reader's language.
 *
 * The server answers every refusal with a code as well as a message in
 * English; the message is for its logs, the code is for here. These used to
 * be shown as they came, so a French reader who mistyped a password was told
 * "Invalid email or password". Anything without a known code falls back to a
 * sentence that is at least true.
 */

import { t } from '../i18n.js';

const BY_CODE = {
  INVALID_CREDENTIALS: 'account.errors.credentials',
  NO_PASSWORD: 'account.errors.noPassword',
  EMAIL_TAKEN: 'account.errors.emailTaken',
  PSEUDO_TAKEN: 'account.nicknameTaken',
  BAD_EMAIL: 'account.errors.badEmail',
  BAD_PSEUDO: 'account.nicknameRules',
  WEAK_PASSWORD: 'account.errors.weakPassword',
  WRONG_PASSWORD: 'account.errors.wrongPassword',
  INVALID_TOKEN: 'mail.linkExpired',
};

export function describeAuthError(error) {
  const key = error && BY_CODE[error.code];
  if (key) return t(key);
  if (error && error.status === 429) return t('account.errors.tooMany');
  if (!error || !error.status) return t('account.errors.offline');
  return t('account.errors.generic');
}
