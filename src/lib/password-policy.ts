/**
 * The account password rule. Pure and dependency-free on purpose: the server routes, the
 * Zod schema and the four client forms all have to answer with the same verdict, and
 * `encryption.ts` cannot be imported into a browser bundle.
 */

// Hard ceiling on accepted password length. bcrypt itself is bounded at 72 bytes, but
// cost-14 hashing on multi-MB input is a CPU DoS vector regardless.
export const MAX_PASSWORD_LENGTH = 128

const MIN_PASSWORD_LENGTH = 10
const REQUIRED_CHARACTER_CLASSES = 2

export const passwordRuleHint = '至少 10 位，且包含大写字母、小写字母、数字、符号中的至少两类'

// NordPass Top 200 — 2025
const commonPasswords = [
  '123456', 'admin', '12345678', '123456789', '12345',
  'password', 'aa123456', '1234567890', 'pass@123', 'admin123',
  '1234567', '123123', '111111', '12345678910', 'p@ssw0rd',
  'aa@123456', 'admintelecom', 'admin@123', '112233', '102030',
  '654321', 'abcd1234', 'abc123', 'qwerty123', 'abcd@1234',
  'pass@1234', '11223344', 'admin@123', '87654321', '987654321',
  'qwerty', '123123123', '1q2w3e4r', 'aa112233', '12341234',
  'qwertyuiop', '11111111', 'password@123', 'asd123', 'aboy1234',
  '123321', 'admin1', 'demo@123', '1q2w3e4r5t', 'admin1234',
  '121212', 'asdf1234', '888888', 'abcd1234', '123456789',
  'guru123456', '666666', 'welcome@123', 'guest', 'password1',
  '123456789a', 'kapler123', 'administrator', '1122334455', 'test@123',
  'qwer1234', 'asdfghjkl', 'global123@', '10203040', '1234qwer',
  'india@123', 'abcd@123', '1qaz2wsx', '88888888', '123qwe',
  '12345678a', 'secret', 'aa123123', '12344321', '123456aa@',
  '123456a', 'a123456', '202020', '1234abcd', 'admin123456',
  'qwe123', '101010', '222222', '12121212', 'welcome',
  'abc12345', 'abc@1234', 'admin12345', 'qwerty123', '12345678900',
  '123654', '555555', 'aa123456789', '1111111111', '12345678901',
  'q1w2e3r4', 'password123', 'heslo1234', '22446688', 'abc12345',
  'vodafone', '999999', 'bismillah', 'a123456789', 'password123',
  'azerty', 'user1234', '1234567891', '1234512345', 'adminisp',
  '1234567899', 'p@$$w0rd', 'aa12345678', 'passw0rd', 'zxcvbnm',
  'adminadmin', 'qwerty12345', 'gvt12345', 'minecraft', 'abcd@1234',
  'pakistan', '10203', 'welcome1', 'theworldinyourhand', 'aabb1122',
  'test123', 'asdf1234', '54321', '1111111', 'a1b2c3d4',
  'student', 'abc@12345', 'aa102030', 'pass@12345',
  '135790', '123abc', 'cisco', '11111', 'aa@12345',
  '111111111', 'p@ssw0rd', 'lol123456', '147258369', '123456aa',
  'aa@1234567', 'admin@1234', '1234554321', '124578', '12qwaszx',
  'abc@123', 'a12345678', 'aa112233', 'qwer4321', 'a1234567',
  'qwerty@123', '12345679', 'ab123456', 'aa@123456789', 'abcd1234@',
  '123qweasd', 'admin1234', 'pakistan123', 'a123456a', 'qwerty1234',
  '1234567a', 'abc123456', 'turktelekom', 'test1234', '999999999',
  '123456788', 'aaa111', 'contraseña', '7654321', '1qazxsw2',
  'password@1', 'asdasd', 'aaaaaa', 'qwerty123456', '246810',
  '11112222', 'aaaa1111', 'abc123', 'q1w2e3r4t5', '987654',
  'aa123123', 'azerty123', 'aa1234567', 'abc@123', 'changeme',
  '12345678@', 'p@55w0rd', 'asd12345', 'zxcvbnm123', '123admin',
]

export function validateAccountPassword(password: string): {
  isValid: boolean
  errors: string[]
  strength: 'weak' | 'medium' | 'strong'
} {
  const errors: string[] = []

  // Reject oversized input up front — the regex/sequence checks below scan the full
  // string and would otherwise burn CPU on attacker-controlled payloads.
  if (typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) {
    return {
      isValid: false,
      errors: [`Password must not exceed ${MAX_PASSWORD_LENGTH} characters`],
      strength: 'weak',
    }
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`)
  }

  const characterClasses = [
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length

  if (characterClasses < REQUIRED_CHARACTER_CLASSES) {
    errors.push('Password must contain at least two of: uppercase letter, lowercase letter, number, special character')
  }

  if (commonPasswords.includes(password.toLowerCase())) {
    errors.push('Password is too common. Please choose a stronger password')
  }

  // Check for repeated characters (e.g., "aaaa")
  if (/(.)\1{3,}/.test(password)) {
    errors.push('Password contains too many repeated characters')
  }

  // Check for sequential characters (e.g., "1234", "abcd")
  const sequences = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm']
  const lowerPassword = password.toLowerCase()
  for (const seq of sequences) {
    for (let i = 0; i <= seq.length - 4; i++) {
      const subseq = seq.substring(i, i + 4)
      if (lowerPassword.includes(subseq) || lowerPassword.includes(subseq.split('').reverse().join(''))) {
        errors.push('Password contains sequential characters')
        break
      }
    }
  }

  let strength: 'weak' | 'medium' | 'strong' = 'weak'
  if (errors.length === 0) {
    if (password.length >= 16 && /[^A-Za-z0-9].*[^A-Za-z0-9]/.test(password)) {
      strength = 'strong' // 16+ chars with multiple special chars
    } else {
      strength = 'medium'
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    strength,
  }
}
