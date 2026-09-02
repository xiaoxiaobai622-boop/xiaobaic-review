/**
 * Feishu (Lark) API Client
 *
 * Handles:
 * - Tenant access token acquisition (with in-memory cache)
 * - OAuth user authorization flow
 * - Sending interactive message cards to users
 */

import { logError, logMessage } from './logging'

// ============================================================================
// Configuration
// ============================================================================

const FEISHU_APP_ID = process.env.FEISHU_APP_ID
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET
const FEISHU_OAUTH_REDIRECT_URI = process.env.FEISHU_OAUTH_REDIRECT_URI || 'https://mle6.cn/api/auth/feishu/callback'

if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
  logError('FEISHU_APP_ID and FEISHU_APP_SECRET must be set in environment variables')
}

// Feishu open platform API base URLs
const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis'

// ============================================================================
// Tenant Access Token (cached in memory)
// ============================================================================

interface TenantTokenCache {
  token: string
  expiresAt: number // Unix timestamp in ms
}

let tenantTokenCache: TenantTokenCache | null = null

/**
 * Get tenant_access_token from Feishu (with in-memory cache).
 * Tenant access token is used for server-to-server API calls.
 */
export async function getTenantAccessToken(): Promise<string> {
  // Check cache
  if (tenantTokenCache && tenantTokenCache.expiresAt > Date.now() + 60_000) {
    return tenantTokenCache.token
  }

  // Fetch new token
  try {
    const response = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        app_id: FEISHU_APP_ID,
        app_secret: FEISHU_APP_SECRET,
      }),
    })

    const data = await response.json()

    if (data.code !== 0) {
      throw new Error(`Feishu API error: ${data.msg} (code: ${data.code})`)
    }

    const token = data.tenant_access_token
    const expiresIn = data.expire || 7200 // Default 2 hours

    tenantTokenCache = {
      token,
      expiresAt: Date.now() + expiresIn * 1000,
    }

    return token
  } catch (error) {
    logError('Failed to get Feishu tenant access token:', error)
    throw error
  }
}

// ============================================================================
// OAuth Authorization Flow
// ============================================================================

/**
 * Generate Feishu OAuth authorization URL.
 * User clicks this URL to authorize the app.
 */
export function getFeishuAuthUrl(state: string): string {
  if (!FEISHU_APP_ID) throw new Error('FEISHU_APP_ID is not configured')
  if (!FEISHU_OAUTH_REDIRECT_URI) throw new Error('FEISHU_OAUTH_REDIRECT_URI is not configured')

  const params = new URLSearchParams({
    app_id: FEISHU_APP_ID,
    redirect_uri: FEISHU_OAUTH_REDIRECT_URI,
    state,
    scope: 'contact:user.base:readonly',
  })
  return `https://open.feishu.cn/open-apis/authen/v1/authorize?${params.toString()}`
}

interface FeishuUserInfo {
  openId: string
  unionId?: string
  tenantKey?: string
  name: string
  avatarUrl?: string
  mobile?: string
  email?: string
  userAccessToken?: string
  refreshToken?: string
  expiresIn?: number
}

function firstNonEmpty(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim()
}

export interface FeishuProfile {
  name?: string
  avatarUrl?: string
}

function parseFeishuProfile(data: any): FeishuProfile {
  const profile = data?.data?.user || data?.data || {}
  const avatar = profile.avatar || {}
  return {
    name: firstNonEmpty(profile.name, profile.en_name, profile.nickname),
    avatarUrl: firstNonEmpty(
      profile.avatar_url,
      profile.avatar_big,
      profile.avatar_middle,
      profile.avatar_thumb,
      avatar.avatar_origin,
      avatar.avatar_640,
      avatar.avatar_240,
      avatar.avatar_72,
      avatar.avatar_32,
    ),
  }
}

/** Read the personal profile returned for an OAuth user access token. */
export async function fetchFeishuProfileByUserAccessToken(accessToken: string): Promise<FeishuProfile> {
  const response = await fetch(`${FEISHU_API_BASE}/authen/v1/user_info`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || data?.code !== 0) {
    throw new Error(`Failed to fetch Feishu user profile: ${data?.msg || `HTTP ${response.status}`}`)
  }
  return parseFeishuProfile(data)
}

export interface FeishuUserToken {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
}

/** Exchange a refresh token for a new OAuth user access token. */
export async function refreshFeishuUserAccessToken(refreshToken: string): Promise<FeishuUserToken> {
  const tenantToken = await getTenantAccessToken()
  const response = await fetch(`${FEISHU_API_BASE}/authen/v1/oidc/refresh_access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tenantToken}`,
    },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || data?.code !== 0 || !data?.data?.access_token) {
    throw new Error(`Failed to refresh Feishu user token: ${data?.msg || `HTTP ${response.status}`}`)
  }
  return {
    accessToken: data.data.access_token,
    refreshToken: data.data.refresh_token,
    expiresIn: data.data.expires_in,
  }
}

/** Fetch the current display profile for an OAuth binding using its open_id. */
export async function fetchFeishuProfileByOpenId(openId: string): Promise<FeishuProfile> {
  const tenantToken = await getTenantAccessToken()
  const response = await fetch(
    `${FEISHU_API_BASE}/contact/v3/users/${encodeURIComponent(openId)}?user_id_type=open_id`,
    {
      headers: { Authorization: `Bearer ${tenantToken}` },
      cache: 'no-store',
    },
  )
  const data = await response.json().catch(() => null)
  if (!response.ok || data?.code !== 0) {
    throw new Error(`Failed to fetch Feishu profile: ${data?.msg || `HTTP ${response.status}`}`)
  }

  const profile = data?.data?.user || data?.data || {}
  const avatar = profile.avatar || {}
  return {
    name: firstNonEmpty(profile.name, profile.en_name, profile.nickname),
    avatarUrl: firstNonEmpty(
      profile.avatar_url,
      profile.avatar_big,
      profile.avatar_middle,
      profile.avatar_thumb,
      avatar.avatar_origin,
      avatar.avatar_640,
      avatar.avatar_240,
      avatar.avatar_72,
      avatar.avatar_32,
    ),
  }
}

/**
 * Exchange OAuth code for user access token and fetch user info.
 */
export async function exchangeCodeForUser(code: string): Promise<FeishuUserInfo> {
  try {
    // The oidc/access_token endpoint requires a tenant_access_token so Feishu
    // can identify which app is exchanging the code. Without it the API
    // returns code 20014.
    const tenantToken = await getTenantAccessToken()

    // Step 1: Exchange code for user_access_token
    const tokenResponse = await fetch(`${FEISHU_API_BASE}/authen/v1/oidc/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenantToken}`,
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
      }),
    })

    const tokenData = await tokenResponse.json()

    if (tokenData.code !== 0) {
      throw new Error(`Failed to exchange code: ${tokenData.msg || JSON.stringify(tokenData)} (code: ${tokenData.code})`)
    }

    const userAccessToken = tokenData.data.access_token

    // Step 2: Get user info with user_access_token
    const userInfoResponse = await fetch(`${FEISHU_API_BASE}/authen/v1/user_info`, {
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
      },
    })

    const userInfoData = await userInfoResponse.json()

    if (userInfoData.code !== 0) {
      throw new Error(`Failed to get user info: ${userInfoData.msg} (code: ${userInfoData.code})`)
    }

    const profile = userInfoData.data || {}
    const avatar = profile.avatar || {}
    return {
      openId: profile.open_id,
      unionId: profile.union_id,
      tenantKey: profile.tenant_key,
      name: firstNonEmpty(profile.name, profile.en_name, profile.nickname) || '飞书用户',
      avatarUrl: firstNonEmpty(
        profile.avatar_url,
        profile.avatar_big,
        profile.avatar_middle,
        profile.avatar_thumb,
        avatar.avatar_origin,
        avatar.avatar_640,
        avatar.avatar_240,
        avatar.avatar_72,
        avatar.avatar_32,
      ),
      mobile: profile.mobile,
      email: profile.email,
      userAccessToken,
      refreshToken: tokenData.data.refresh_token,
      expiresIn: tokenData.data.expires_in,
    }
  } catch (error) {
    logError('Failed to exchange Feishu OAuth code:', error)
    throw error
  }
}

// ============================================================================
// Send Interactive Message Card
// ============================================================================

interface MessageCardButton {
  text: string
  url: string
  type?: 'default' | 'primary' | 'danger'
}

interface SendCardOptions {
  title: string
  content: string // Markdown-style content
  buttons?: MessageCardButton[]
}

export interface ReviewCommentCardInput {
  projectTitle: string
  videoName: string
  versionLabel?: string | null
  comments: Array<{ timecode: string; content: string }>
  reviewerName: string
}

/**
 * Build the canonical review-comment card used by every Feishu push entry.
 * Project-level pushes call this once per video so their message is identical
 * to the card sent from the review page's "推送本集" action.
 */
export function buildReviewCommentCard({
  projectTitle,
  videoName,
  versionLabel,
  comments,
  reviewerName,
}: ReviewCommentCardInput): Pick<SendCardOptions, 'title' | 'content'> {
  let content = `**项目：** ${projectTitle}\n**视频：** ${videoName}\n**版本：** ${versionLabel || '—'}\n\n本次新增 **${comments.length}** 条批注意见\n\n━━━━━━━━━━━━━━\n\n`

  content += comments
    .slice(0, 10)
    .map((comment) => `**${comment.timecode}**\n${comment.content}`)
    .join('\n\n')

  if (comments.length > 10) {
    content += `\n\n...还有 ${comments.length - 10} 条批注意见`
  }

  content += `\n\n━━━━━━━━━━━━━━\n审阅人：${reviewerName}`

  return {
    title: '🎬 MLE6 逐帧审阅批注意见',
    content,
  }
}

/**
 * Send an interactive message card to a Feishu user (direct message).
 *
 * @param openId - Recipient's open_id
 * @param options - Card content options
 * @returns Feishu message_id on success
 */
export async function sendMessageCard(openId: string, options: SendCardOptions): Promise<string> {
  const tenantToken = await getTenantAccessToken()

  const card = {
    header: {
      title: {
        tag: 'plain_text',
        content: options.title,
      },
      template: 'blue', // Can be: blue, wathet, turquoise, green, yellow, orange, red, carmine, violet, purple, indigo, grey
    },
    elements: [
      {
        tag: 'markdown',
        content: options.content,
      },
      ...(options.buttons || []).map((btn) => ({
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: btn.text,
            },
            type: btn.type || 'default',
            url: btn.url,
          },
        ],
      })),
    ],
  }

  try {
    const response = await fetch(`${FEISHU_API_BASE}/im/v1/messages?receive_id_type=open_id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tenantToken}`,
      },
      body: JSON.stringify({
        receive_id: openId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      }),
    })

    const data = await response.json()

    if (data.code !== 0) {
      throw new Error(`Failed to send message card: ${data.msg} (code: ${data.code})`)
    }

    logMessage(`Sent Feishu message card to ${openId}: ${data.data.message_id}`)
    return data.data.message_id
  } catch (error) {
    logError('Failed to send Feishu message card:', error)
    throw error
  }
}
