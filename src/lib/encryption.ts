import { logError, logWarn } from './logging'
import { MAX_PASSWORD_LENGTH } from './password-policy'

const isEdgeRuntime = typeof process !== 'undefined' && process.env.NEXT_RUNTIME === 'edge'

// Lazy-load crypto so the module isn't pulled into Edge bundles.
let cryptoModule: typeof import('crypto') | null = null

function getCrypto(): typeof import('crypto') {
  if (cryptoModule) return cryptoModule

  if (isEdgeRuntime) {
    throw new Error('Encryption utilities require the Node.js runtime. Set runtime = \"nodejs\" for routes that use them.')
  }

  // Safe to require because all callers run on the server (Node.js)

  cryptoModule = require('crypto') as typeof import('crypto')
  return cryptoModule
}

// Lazy-load bcryptjs (ESM in v3) so it isn't pulled into Edge bundles.
let bcryptModule: any = null

async function getBcrypt() {
  if (bcryptModule) return bcryptModule
  if (isEdgeRuntime) {
    throw new Error('Encryption utilities require the Node.js runtime. Set runtime = \"nodejs\" for routes that use them.')
  }
  const mod = await import('bcryptjs')
  // bcryptjs v3 is ESM — the bcrypt object is on mod.default
  bcryptModule = mod.default ?? mod
  return bcryptModule
}

// Encryption key REQUIRED in production (see README for setup instructions)
// Skip validation during build or if explicitly disabled
const skipValidation = process.env.SKIP_ENV_VALIDATION === '1'

// This module can be dragged into a browser bundle by an indirect import (src/lib/db.ts reaches
// it from shared modules such as src/i18n/locale.ts). The check is about the server's own
// environment, so it must not run there: in a client bundle NODE_ENV is 'production' and
// ENCRYPTION_KEY is always absent, which used to throw on load and blank the whole page tree.
const isServer = typeof window === 'undefined'

if (isServer && !skipValidation && !process.env.ENCRYPTION_KEY) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ENCRYPTION_KEY must be set in production. See README for setup instructions.')
  } else {
    logWarn('WARNING: Using insecure ENCRYPTION_KEY for DEVELOPMENT only. See README for production setup.')
  }
}

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'DEV_ONLY_INSECURE_KEY_32BYTES!'
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16

/**
 * Validate that encryption key is configured properly (runtime check)
 */
function validateEncryptionKey(): void {
  // Skip validation during build or if explicitly disabled
  if (process.env.SKIP_ENV_VALIDATION === '1') {
    return
  }
  
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.ENCRYPTION_KEY) {
      throw new Error('ENCRYPTION_KEY must be set in production. See README for setup instructions.')
    }
    if (process.env.ENCRYPTION_KEY === 'DEV_ONLY_INSECURE_KEY_32BYTES!') {
      throw new Error('Production ENCRYPTION_KEY must not use default development value. Generate a secure key using: openssl rand -base64 32')
    }
  }
}

/**
 * Derive encryption key using scrypt (Key Derivation Function)
 */
function getEncryptionKey(): Buffer {
  const crypto = getCrypto()

  // Fixed salt for deterministic key derivation
  const salt = 'vitransfer-encryption-v1'

  // N=1024, r=8, p=1 provides good security with minimal performance impact
  return crypto.scryptSync(ENCRYPTION_KEY, salt, 32, {
    N: 1024,
    r: 8,
    p: 1
  })
}

/**
 * Deterministic keyed digest for values that must stay searchable while the stored form is
 * not readable — a phone number is looked up by equality, so the ciphertext alone cannot
 * serve. Domain separation keeps each use of the master key on its own subkey, so one
 * column's digest can never be replayed against another's.
 */
const indexSubkeys = new Map<string, Buffer>()

export function hmacIndexValue(value: string, domain: string): string {
  validateEncryptionKey()
  const crypto = getCrypto()
  let subkey = indexSubkeys.get(domain)
  if (!subkey) {
    subkey = Buffer.from(
      crypto.hkdfSync('sha256', Buffer.from(ENCRYPTION_KEY), Buffer.from('vitransfer-index-v1'), Buffer.from(domain), 32),
    )
    indexSubkeys.set(domain, subkey)
  }
  return crypto.createHmac('sha256', subkey).update(value, 'utf8').digest('hex')
}

/**
 * Encrypt sensitive data
 * @param text Plain text to encrypt
 * @returns Encrypted string in format: iv:authTag:encryptedData (hex)
 */
export function encrypt(text: string): string {
  if (!text) return ''
  
  validateEncryptionKey()
  
  try {
    const crypto = getCrypto()
    const key = getEncryptionKey()
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
    
    let encrypted = cipher.update(text, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    
    const authTag = cipher.getAuthTag()
    
    // Return format: iv:authTag:encryptedData
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
  } catch (error) {
    logError('Encryption error:', error)
    throw new Error('Failed to encrypt data')
  }
}

/**
 * Decrypt sensitive data
 * @param encryptedText Encrypted string in format: iv:authTag:encryptedData
 * @returns Decrypted plain text
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText) return ''
  
  validateEncryptionKey()
  
  try {
    const crypto = getCrypto()
    const key = getEncryptionKey()
    const parts = encryptedText.split(':')
    
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format')
    }
    
    const iv = Buffer.from(parts[0], 'hex')
    const authTag = Buffer.from(parts[1], 'hex')
    const encrypted = parts[2]
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    
    return decrypted
  } catch (error) {
    logError('Decryption error:', error)
    throw new Error('Failed to decrypt data')
  }
}

/**
 * Hash a password using bcrypt
 * @param password Plain text password
 * @returns Hashed password
 */
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) {
    throw new Error('Password exceeds maximum allowed length')
  }
  const bcrypt = await getBcrypt()
  const salt = await bcrypt.genSalt(14)
  return bcrypt.hash(password, salt)
}

/**
 * Verify a password against a hash
 * @param password Plain text password
 * @param hash Hashed password
 * @returns True if password matches
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) {
    return false
  }
  const bcrypt = await getBcrypt()
  return bcrypt.compare(password, hash)
}
