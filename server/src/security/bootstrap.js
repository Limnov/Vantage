const crypto = require('node:crypto');

const DISALLOWED_ADMIN_PASSWORDS = new Set([
  'admin123',
  'password',
  'changeme',
  'replace-with-a-strong-password'
]);

// 已公开版本历史中出现过的凭据只保留不可逆指纹，避免再次提交明文。
const DISALLOWED_ADMIN_PASSWORD_FINGERPRINTS = new Set([
  '52ab427a1fbb23887f986ed5d3cbff750402cc90442ad07088a1f70a1a39fdca'
]);

const LOCAL_DEV_ADMIN = Object.freeze({
  username: 'admin',
  password: 'admin123'
});

function isLoopbackHost(value) {
  const host = String(value || '').trim().toLowerCase();
  return host === '127.0.0.1' || host === '::1';
}

function isInsecureLocalDevAdminAllowed(env = process.env) {
  return String(env.ALLOW_INSECURE_DEV_ADMIN || '').toLowerCase() === 'true'
    && String(env.NODE_ENV || '').toLowerCase() === 'development'
    && isLoopbackHost(env.HOST || '0.0.0.0')
    && String(env.ADMIN_USERNAME || 'admin') === LOCAL_DEV_ADMIN.username
    && String(env.ADMIN_PASSWORD || '') === LOCAL_DEV_ADMIN.password;
}

function validateAdminBootstrapConfig(env = process.env) {
  if (String(env.ALLOW_INSECURE_DEV_ADMIN || '').toLowerCase() !== 'true') return;
  if (!isInsecureLocalDevAdminAllowed(env)) {
    const error = new Error(
      'ALLOW_INSECURE_DEV_ADMIN is only valid for admin/admin123 in development on a loopback HOST'
    );
    error.code = 'UNSAFE_DEV_ADMIN_CONFIG';
    throw error;
  }
}

function validateAdminPassword(value) {
  const password = String(value || '');
  if (password.length < 12 || isDisallowedAdminPassword(password)) {
    const error = new Error('ADMIN_PASSWORD must be explicitly set to a non-default value with at least 12 characters');
    error.code = 'UNSAFE_ADMIN_PASSWORD';
    throw error;
  }
  return password;
}

function isDisallowedAdminPassword(value) {
  const password = String(value || '');
  const fingerprint = crypto.createHash('sha256').update(password).digest('hex');
  return DISALLOWED_ADMIN_PASSWORDS.has(password.toLowerCase())
    || DISALLOWED_ADMIN_PASSWORD_FINGERPRINTS.has(fingerprint);
}

function resolveAdminPassword(value, env = process.env) {
  if (isInsecureLocalDevAdminAllowed(env)) return LOCAL_DEV_ADMIN.password;
  return validateAdminPassword(value);
}

async function findKnownDefaultPassword(passwordHash, compare) {
  for (const candidate of DISALLOWED_ADMIN_PASSWORDS) {
    if (await compare(candidate, passwordHash).catch(() => false)) return candidate;
  }
  return null;
}

async function validateAdminAccountState(query, compare, env = process.env) {
  const rows = await query(
    'SELECT username, password_hash FROM users WHERE is_system_admin = 1 AND is_active = 1'
  );
  for (const row of rows) {
    const matched = await findKnownDefaultPassword(row.password_hash, compare);
    if (!matched) continue;
    if (
      matched === LOCAL_DEV_ADMIN.password
      && row.username === LOCAL_DEV_ADMIN.username
      && isInsecureLocalDevAdminAllowed(env)
    ) {
      continue;
    }
    const error = new Error(
      `Active system administrator "${row.username}" uses a known default password; rotate it before startup`
    );
    error.code = 'UNSAFE_ADMIN_ACCOUNT';
    throw error;
  }
}

module.exports = {
  LOCAL_DEV_ADMIN,
  isDisallowedAdminPassword,
  isInsecureLocalDevAdminAllowed,
  findKnownDefaultPassword,
  validateAdminAccountState,
  validateAdminBootstrapConfig,
  validateAdminPassword,
  resolveAdminPassword
};
