import { createHash, createHmac } from 'crypto'

export interface TencentApiRequest {
  service: string
  host: string
  version: string
  region: string
  secretId: string
  secretKey: string
  action: string
  payload: Record<string, unknown>
}

export async function callTencentApi(request: TencentApiRequest): Promise<any> {
  const { service, host, version, region, secretId, secretKey, action, payload } = request
  const body = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const contentType = 'application/json; charset=utf-8'
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`
  const signedHeaders = 'content-type;host'
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(body)}`
  // Tencent TC3 scope is date/service/tc3_request. Region is sent as a
  // request header and is intentionally not a scope component.
  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256(canonicalRequest)}`
  const secretDate = hmac(`TC3${secretKey}`, date)
  const signingKey = hmac(hmac(secretDate, service), 'tc3_request')
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const response = await fetch(`https://${host}`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': contentType,
      Host: host,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': region,
    },
    body,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data?.Response?.Error) {
    const err = data?.Response?.Error
    throw new Error(`Tencent ${service} ${action} failed: ${err?.Code || response.status} ${err?.Message || response.statusText}`)
  }
  return data.Response
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}
