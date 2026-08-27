import { createHash, createHmac } from 'crypto'

const SERVICE = 'mps'
const VERSION = '2019-06-12'
const HOST = 'mps.tencentcloudapi.com'

export interface MpsHlsResult {
  taskId: string
  hlsPath: string
}

interface MpsConfig {
  secretId: string
  secretKey: string
  region: string
  templateId: number
  outputDir: string
  pollIntervalMs: number
  maxWaitMs: number
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

function config(): MpsConfig {
  const templateId = Number(process.env.TENCENT_MPS_TEMPLATE_ID || '1796772')
  if (!Number.isInteger(templateId) || templateId <= 0) {
    throw new Error('TENCENT_MPS_TEMPLATE_ID must be a positive integer')
  }
  return {
    // Existing COS credentials are Tencent CAM credentials.
    secretId: required('S3_ACCESS_KEY_ID'),
    secretKey: required('S3_SECRET_ACCESS_KEY'),
    region: process.env.TENCENT_MPS_REGION?.trim() || process.env.S3_REGION?.trim() || 'ap-shanghai',
    templateId,
    outputDir: (process.env.TENCENT_MPS_OUTPUT_DIR?.trim() || 'projects/mps-output').replace(/^\/+|\/+$/g, ''),
    pollIntervalMs: Math.max(1000, Number(process.env.TENCENT_MPS_POLL_INTERVAL_MS || '5000')),
    maxWaitMs: Math.max(60_000, Number(process.env.TENCENT_MPS_MAX_WAIT_MS || '1800000')),
  }
}

export function isMpsEnabled(): boolean {
  return process.env.TENCENT_MPS_ENABLED === 'true'
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}

async function callApi(action: string, payload: Record<string, unknown>): Promise<any> {
  const cfg = config()
  const body = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const contentType = 'application/json; charset=utf-8'
  const canonicalHeaders = `content-type:${contentType}\nhost:${HOST}\n`
  const signedHeaders = 'content-type;host'
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(body)}`
  // Tencent TC3 scope is date/service/tc3_request. Region is sent as a
  // request header and is intentionally not a scope component.
  const credentialScope = `${date}/${SERVICE}/tc3_request`
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256(canonicalRequest)}`
  const secretDate = hmac(`TC3${cfg.secretKey}`, date)
  const secretService = hmac(secretDate, SERVICE)
  const signingKey = hmac(secretService, 'tc3_request')
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  const authorization = `TC3-HMAC-SHA256 Credential=${cfg.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const response = await fetch(`https://${HOST}`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': contentType,
      Host: HOST,
      'X-TC-Action': action,
      'X-TC-Version': VERSION,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': cfg.region,
    },
    body,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data?.Response?.Error) {
    const err = data?.Response?.Error
    throw new Error(`Tencent MPS ${action} failed: ${err?.Code || response.status} ${err?.Message || response.statusText}`)
  }
  return data.Response
}

export async function submitMpsHls(inputObject: string, videoId: string): Promise<string> {
  const cfg = config()
  const bucket = required('S3_BUCKET')
  const response = await callApi('ProcessMedia', {
    InputInfo: {
      Type: 'COS',
      CosInputInfo: { Bucket: bucket, Region: process.env.S3_REGION || cfg.region, Object: inputObject },
    },
    OutputStorage: {
      Type: 'COS',
      CosOutputStorage: { Bucket: bucket, Region: process.env.S3_REGION || cfg.region },
    },
    MediaProcessTask: {
      TranscodeTaskSet: [{
        Definition: cfg.templateId,
        OutputObjectPath: `/${cfg.outputDir}/${videoId}/{inputName}_{definition}.{format}`,
      }],
    },
  })
  const taskId = response?.TaskId || response?.Task?.TaskId
  if (!taskId) throw new Error('Tencent MPS returned no task id')
  return String(taskId)
}

function findM3u8(value: unknown): string | null {
  if (typeof value === 'string' && value.toLowerCase().includes('.m3u8')) return value.replace(/^\/+/, '')
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findM3u8(item)
      if (found) return found
    }
  } else if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    for (const key of ['ObjectName', 'Object', 'Url', 'UrlFile']) {
      const found = findM3u8(object[key])
      if (found) return found
    }
    for (const item of Object.values(object)) {
      const found = findM3u8(item)
      if (found) return found
    }
  }
  return null
}

export async function waitForMpsHls(taskId: string): Promise<MpsHlsResult> {
  const cfg = config()
  const startedAt = Date.now()
  while (Date.now() - startedAt <= cfg.maxWaitMs) {
    const response = await callApi('DescribeTaskDetail', { TaskId: taskId })
    const task = response?.Task || response?.TaskDetail || response
    const status = String(task?.Status ?? task?.TaskStatus ?? '').toUpperCase()
    if (['FINISH', 'FINISHED', 'SUCCESS', 'SUCCEED', '5'].includes(status)) {
      const hlsPath = findM3u8(task)
      if (!hlsPath) throw new Error('Tencent MPS finished without an M3U8 output')
      return { taskId, hlsPath }
    }
    if (['FAIL', 'FAILED', 'ERROR', '4'].includes(status)) {
      throw new Error(`Tencent MPS task failed: ${task?.Message || task?.ErrMsg || status}`)
    }
    await new Promise((resolve) => setTimeout(resolve, cfg.pollIntervalMs))
  }
  throw new Error(`Tencent MPS task timed out after ${cfg.maxWaitMs}ms`)
}
